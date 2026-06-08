#!/usr/bin/env python3
"""
price_alert.py — A股价格预警监控脚本 v2.0
用法示例:
  python price_alert.py --code sh601868 --target 2.90 --dir below
  python price_alert.py --code sz000560 --target 2.60 --dir above --interval 15
  python price_alert.py --config alert_config.json
  python price_alert.py --code sh601868 --target 2.87 --dir below --source tencent

数据源:
  tdx       通达信协议直连（默认，~15ms延迟，郑州节点）
  tencent   腾讯行情接口（备用，~155ms延迟）

参数:
  --code       股票代码 (如 sh601868, sz000560)
  --name       股票名称 (可选，自动从接口获取)
  --target     目标价格 (必填)
  --dir        方向: below=跌破提醒, above=涨破提醒, both=双向提醒
  --interval   检查间隔秒数 (默认5，配合tdx源15ms延迟足够)
  --source     数据源: tdx(默认) | tencent
  --host       自定义通达信服务器 (如 182.118.8.4:7709)
  --config     JSON配置文件路径 (可同时监控多只股票)
  --log        日志文件路径 (默认 reports/price_alert_日志.txt)
  --notify     提醒方式: popup(默认弹窗) | log(仅日志)
"""

import argparse
import json
import os
import sys
import time
import datetime
import subprocess
import threading

SCRIPT_DIR = None

# ============================================================
# 默认通达信服务器：云行情郑州主站（3.5ms TCP握手）
# ============================================================
DEFAULT_TDX_HOST = '182.118.8.4:7709'

# 全局eltdx客户端（连接复用）
_tdx_client = None


def get_tdx_client(host=None):
    """获取或创建eltdx客户端（单例，连接复用）"""
    global _tdx_client
    if _tdx_client is not None:
        return _tdx_client
    from eltdx import Client
    _tdx_client = Client(host=host or DEFAULT_TDX_HOST)
    return _tdx_client


def close_tdx_client():
    """关闭eltdx连接"""
    global _tdx_client
    if _tdx_client is not None:
        try:
            _tdx_client.close()
        except Exception:
            pass
        _tdx_client = None


def show_popup(title, message):
    """Windows本地弹窗通知（零依赖，ctypes调用原生API）"""
    try:
        import ctypes
        # MB_ICONWARNING = 0x30, MB_OK = 0x00
        ctypes.windll.user32.MessageBoxW(0, message, title, 0x30)
    except Exception:
        # 如果MessageBox不可用，回退到PowerShell弹窗
        try:
            ps_cmd = (
                f'Add-Type -AssemblyName System.Windows.Forms; '
                f'[System.Windows.Forms.MessageBox]::Show("{message}", "{title}", '
                f'[System.Windows.Forms.MessageBoxButtons]::OK, '
                f'[System.Windows.Forms.MessageBoxIcon]::Warning)'
            )
            subprocess.Popen(
                ['powershell', '-NoProfile', '-Command', ps_cmd],
                creationflags=subprocess.CREATE_NO_WINDOW
            )
        except Exception:
            print(f'[POPUP FAILED] {title}: {message}')


def show_popup_async(title, message):
    """异步弹窗（不阻塞监控循环）"""
    t = threading.Thread(target=show_popup, args=(title, message), daemon=True)
    t.start()


def get_quote_tdx(code, host=None):
    """从通达信协议获取实时行情（郑州节点，~15ms延迟）"""
    client = get_tdx_client(host)
    result = client.get_quote(code)
    if not result or len(result) == 0:
        raise ValueError(f'未获取到数据: {code}')

    q = result[0]
    # 计算涨跌幅
    pre_close = q.pre_close_price
    last_price = q.last_price
    change_pct = None
    if pre_close and pre_close > 0:
        change_pct = ((last_price - pre_close) / pre_close) * 100

    return {
        'name': code,  # tdx协议不返回名称，用code
        'code': code,
        'price': last_price,
        'yest_close': pre_close,
        'open': q.open_price,
        'high': q.high_price,
        'low': q.low_price,
        'volume': q.total_hand,
        'amount': q.amount,
        'change_pct': change_pct,
        # 盘口
        'bid1': q.buy_levels[0].price if q.buy_levels else None,
        'bid1_vol': q.buy_levels[0].volume if q.buy_levels else None,
        'ask1': q.sell_levels[0].price if q.sell_levels else None,
        'ask1_vol': q.sell_levels[0].volume if q.sell_levels else None,
    }


def get_quote_tencent(code):
    """从腾讯接口获取实时行情（备用，~155ms延迟）"""
    import urllib.request
    url = f'https://qt.gtimg.cn/q={code}'
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=5) as resp:
        content = resp.read().decode('gbk')
    f = content.split('~')
    return {
        'name': f[1],
        'code': f[2],
        'price': float(f[3]),
        'yest_close': float(f[4]),
        'open': float(f[5]) if f[5] else None,
        'high': float(f[33]) if len(f) > 33 and f[33] else None,
        'low': float(f[34]) if len(f) > 34 and f[34] else None,
        'change_pct': float(f[32]) if len(f) > 32 and f[32] else None,
    }


def get_quote(code, source='tdx', host=None):
    """统一行情获取接口"""
    if source == 'tdx':
        return get_quote_tdx(code, host)
    else:
        return get_quote_tencent(code)


def resolve_name(code, source='tdx', host=None):
    """获取股票名称（tdx协议不返回名称，用腾讯接口补充）"""
    try:
        q = get_quote_tencent(code)
        return q.get('name', code)
    except Exception:
        return code


def check_single(code, name, target, direction, interval, log_file,
                 source='tdx', host=None, notify='popup'):
    """监控单只股票"""
    source_label = f'TDX({host or DEFAULT_TDX_HOST})' if source == 'tdx' else 'Tencent'
    print(f'========================================')
    print(f'  PRICE ALERT MONITOR v2.0')
    print(f'  {name} ({code})')
    if direction == 'below':
        print(f'  Condition: price <= {target}')
    elif direction == 'above':
        print(f'  Condition: price >= {target}')
    else:
        print(f'  Condition: price <= {target} OR price >= {target}')
    print(f'  Source: {source_label} | Interval: {interval}s')
    print(f'  Started: {datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'========================================')
    print()

    alert_below = direction in ('below', 'both')
    alert_above = direction in ('above', 'both')
    check_count = 0

    while True:
        try:
            q = get_quote(code, source, host)
            price = q['price']
            if price is None:
                print(f'[{datetime.datetime.now().strftime("%H:%M:%S")}] Price is None, skipping...')
                time.sleep(interval)
                continue
            name = q['name']
            now = datetime.datetime.now().strftime('%H:%M:%S')
            check_count += 1

            triggered = False
            reasons = []

            if alert_below and price <= target:
                triggered = True
                reasons.append(f'price {price:.2f} <= target {target}')
            if alert_above and price >= target:
                triggered = True
                reasons.append(f'price {price:.2f} >= target {target}')

            if triggered:
                diff = price - target
                direction_cn = '跌破' if diff <= 0 else '涨破'
                pct_str = f'{q["change_pct"]:+.2f}%' if q.get('change_pct') is not None else 'N/A'
                alert_line = (
                    f'[{now}] *** ALERT *** {name}({code}) '
                    f'{direction_cn} {target} | 当前价: {price:.2f} | '
                    f'涨跌: {pct_str}'
                )
                print(alert_line)
                with open(log_file, 'a', encoding='utf-8') as f:
                    f.write(alert_line + '\n')
                # 弹窗通知
                if notify == 'popup':
                    popup_msg = (
                        f'{name}({code}) {direction_cn} {target}\n'
                        f'当前价: {price:.2f}\n'
                        f'涨跌幅: {pct_str}\n'
                        f'时间: {now}'
                    )
                    show_popup_async(f'价格预警 - {name}', popup_msg)
                # 触发后继续监控，但降低频率到60秒
                print(f'[{now}] Alert saved. Continuing monitor at 60s interval...')
                time.sleep(60)
                continue
            else:
                diff = price - target
                pct_str = f'{q["change_pct"]:+.2f}%' if q.get('change_pct') is not None else ''
                status = f'diff: {abs(diff):.2f}'
                if pct_str:
                    status += f' | {pct_str}'
                print(f'[{now}] #{check_count} {name} = {price:.2f} ({status}) [OK]')

        except Exception as e:
            now = datetime.datetime.now().strftime('%H:%M:%S')
            print(f'[{now}] Error: {e}')
            # tdx连接失败时尝试重连
            if source == 'tdx':
                close_tdx_client()
            time.sleep(interval)
            continue

        time.sleep(interval)


def check_multi(config_file, source='tdx', host=None, notify='popup'):
    """从JSON配置文件监控多只股票"""
    with open(config_file, 'r', encoding='utf-8') as f:
        config = json.load(f)

    interval = config.get('interval', 5)
    log_file = config.get('log', get_log_path('multi'))
    items = config.get('alerts', [])

    source_label = f'TDX({host or DEFAULT_TDX_HOST})' if source == 'tdx' else 'Tencent'
    print(f'========================================')
    print(f'  MULTI-STOCK PRICE ALERT MONITOR v2.0')
    print(f'  Monitoring {len(items)} stock(s)')
    print(f'  Source: {source_label} | Interval: {interval}s')
    print(f'  Started: {datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'========================================')
    print()

    # 记录已触发的预警（避免重复刷屏，每60秒冷却）
    alert_cooldown = {}

    while True:
        now_str = datetime.datetime.now().strftime('%H:%M:%S')

        for item in items:
            code = item['code']
            target = item['target']
            direction = item.get('dir', 'below')
            name = item.get('name', code)
            alert_below = direction in ('below', 'both')
            alert_above = direction in ('above', 'both')

            try:
                q = get_quote(code, source, host)
                price = q.get('price')
                if price is None:
                    print(f'[{now_str}] {name}({code}) Price is None, skipping')
                    continue
                name = q.get('name', name)

                triggered = False
                reason = ''

                if alert_below and price <= target:
                    triggered = True
                    reason = f'{name}({code}) 跌破 {target} | 当前: {price:.2f}'
                if alert_above and price >= target:
                    triggered = True
                    reason = f'{name}({code}) 涨破 {target} | 当前: {price:.2f}'

                if triggered:
                    # 冷却检查
                    cooldown_key = f'{code}_{direction}'
                    last_alert_time = alert_cooldown.get(cooldown_key, 0)
                    current_time = time.time()

                    if current_time - last_alert_time >= 60:
                        alert_line = f'[{now_str}] *** ALERT *** {reason}'
                        print(alert_line)
                        with open(log_file, 'a', encoding='utf-8') as f:
                            f.write(alert_line + '\n')
                        alert_cooldown[cooldown_key] = current_time
                        if notify == 'popup':
                            show_popup_async('价格预警', reason)
                else:
                    diff = price - target
                    print(f'[{now_str}] {name} = {price:.2f} (target: {target}, diff: {abs(diff):.2f})')

            except Exception as e:
                print(f'[{now_str}] {name}({code}) Error: {e}')
                if source == 'tdx':
                    close_tdx_client()

        time.sleep(interval)


def get_log_path(label):
    """生成日志文件路径"""
    reports_dir = os.path.join(SCRIPT_DIR or '.', 'reports')
    os.makedirs(reports_dir, exist_ok=True)
    today = datetime.datetime.now().strftime('%Y-%m-%d')
    return os.path.join(reports_dir, f'price_alert_{label}_{today}.txt')


def main():
    global SCRIPT_DIR
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

    parser = argparse.ArgumentParser(
        description='A股价格预警监控 v2.0（通达信协议/腾讯接口双源）',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 单只：中国能建跌破2.90提醒（默认用通达信郑州节点，~15ms）
  python price_alert.py --code sh601868 --target 2.90 --dir below

  # 每3秒检查一次（配合tdx源极速响应）
  python price_alert.py --code sh601868 --target 2.87 --dir below --interval 3

  # 强制使用腾讯接口
  python price_alert.py --code sh601868 --target 2.90 --dir below --source tencent

  # 指定其他通达信服务器
  python price_alert.py --code sh601868 --target 2.90 --dir below --host 123.125.108.103:7709

  # 双向：上海建工跌破2.45或涨破2.55都提醒
  python price_alert.py --code sh600170 --target 2.45 --dir both

  # 多只：用配置文件
  python price_alert.py --config my_alerts.json

JSON配置文件格式:
{
  "interval": 5,
  "source": "tdx",
  "log": "reports/my_alerts.txt",
  "alerts": [
    {"code": "sh601868", "name": "中国能建", "target": 2.90, "dir": "below"},
    {"code": "sz000560", "name": "我爱我家", "target": 2.65, "dir": "above"}
  ]
}
        """
    )

    parser.add_argument('--code', type=str, help='股票代码 (如 sh601868)')
    parser.add_argument('--name', type=str, default='', help='股票名称 (可选，自动获取)')
    parser.add_argument('--target', type=float, help='目标价格')
    parser.add_argument('--dir', type=str, default='below',
                        choices=['below', 'above', 'both'],
                        help='方向: below=跌破, above=涨破, both=双向')
    parser.add_argument('--interval', type=int, default=5, help='检查间隔秒数 (默认5)')
    parser.add_argument('--source', type=str, default='tdx',
                        choices=['tdx', 'tencent'],
                        help='数据源: tdx=通达信协议(默认,~15ms) | tencent=腾讯接口(~155ms)')
    parser.add_argument('--host', type=str, default='',
                        help='通达信服务器地址 (如 182.118.8.4:7709，默认郑州节点)')
    parser.add_argument('--log', type=str, default='', help='日志文件路径 (默认自动生成)')
    parser.add_argument('--config', type=str, help='JSON配置文件路径 (监控多只股票)')
    parser.add_argument('--notify', type=str, default='popup',
                        choices=['popup', 'log'],
                        help='提醒方式: popup=本地弹窗(默认) | log=仅写日志文件')

    args = parser.parse_args()

    if args.config:
        check_multi(args.config, args.source, args.host or None, args.notify)
    elif args.code and args.target:
        if not args.name:
            try:
                args.name = resolve_name(args.code, args.source, args.host or None)
            except Exception:
                args.name = args.code

        log_file = args.log or get_log_path(args.code)
        try:
            check_single(args.code, args.name, args.target, args.dir,
                           args.interval, log_file, args.source,
                           args.host or None, args.notify)
        finally:
            close_tdx_client()
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
