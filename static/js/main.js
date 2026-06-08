/**
 * main.js — Stock Monitor Web v3.0
 * 前端交互逻辑
 */

// ============================================================
// 全局状态
// ============================================================

let monitorRunning = false;
let eventSource = null;
let refreshInterval = null;
let currentConfig = null;

// ============================================================
// 初始化
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    // 加载配置
    loadConfig();

    // 检查监控状态
    checkMonitorStatus();

    // 加载节点列表
    loadNodes();

    // 启动定时刷新行情
    refreshInterval = setInterval(refreshQuotes, 3000);

    // 连接SSE预警流
    connectAlertStream();
});

// ============================================================
// API调用函数
// ============================================================

async function apiCall(url, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, options);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('API call failed:', error);
        return { success: false, error: error.message };
    }
}

// ============================================================
// 配置管理
// ============================================================

async function loadConfig() {
    const result = await apiCall('/api/config');
    if (result.success) {
        currentConfig = result.data;
        renderConfigTable();
    }
}

async function saveConfig(config) {
    const result = await apiCall('/api/config', 'POST', config);
    if (result.success) {
        currentConfig = config;
        renderConfigTable();
        showToast('配置已保存', 'success');
    } else {
        showToast('保存失败: ' + (result.error || '未知错误'), 'danger');
    }
}

function renderConfigTable() {
    const tbody = document.getElementById('configTableBody');
    if (!currentConfig || !currentConfig.alerts || currentConfig.alerts.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center text-muted py-4">
                    <i class="bi bi-inbox"></i> 暂无监控股票，点击"添加"开始
                </td>
            </tr>
        `;
        return;
    }

    // 给每只股票分配一个分组索引（用于背景色）
    const stockGroups = {};
    let groupIndex = 0;
    currentConfig.alerts.forEach(item => {
        if (!(item.code in stockGroups)) {
            stockGroups[item.code] = groupIndex % 6; // 6种颜色循环
            groupIndex++;
        }
    });

    tbody.innerHTML = currentConfig.alerts.map((item, index) => {
        const quote = window.quotesCache ? window.quotesCache[item.code] : null;
        const price = quote ? quote.price : '--';
        const changePct = quote ? quote.changePct : null;
        const status = getStatus(item, quote);
        const dir = item.dir || 'below';
        const dirLabel = dir === 'below' ? '跌破' : dir === 'above' ? '涨破' : '双向';
        const dirClass = dir === 'below' ? 'text-success' : dir === 'above' ? 'text-danger' : 'text-primary';

        const groupClass = `stock-group-${stockGroups[item.code]}`;
        const isDivider = index > 0 && currentConfig.alerts[index - 1].code !== item.code;
        const alertClass = status.class === 'status-alert' ? 'alert-row' : status.class === 'status-warning' ? 'warning-row' : '';
        const rowClass = `${groupClass} ${isDivider ? 'stock-divider' : ''} ${alertClass}`;

        return `
            <tr class="${rowClass}">
                <td><strong>${item.name || item.code}</strong></td>
                <td><code>${item.code}</code></td>
                <td class="${getPriceClass(changePct)}">${formatPrice(price)}</td>
                <td>${formatPrice(item.target)}</td>
                <td class="${getPriceClass(changePct)}">${formatChange(changePct)}</td>
                <td><span class="${dirClass}" style="font-size:11px">${dirLabel}</span></td>
                <td><span class="status-badge ${status.class}" style="font-size:10px">${status.text}</span></td>
                <td>
                    <button class="btn btn-outline-primary" onclick="editStock(${index})">
                        <i class="bi bi-pencil"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function getStatus(item, quote) {
    if (!quote || quote.price === null || quote.price === undefined) {
        return { class: 'status-safe', text: '等待数据' };
    }

    const price = quote.price;
    const target = item.target;
    const direction = item.dir || 'below';
    const diff = price - target;
    const diffPct = (diff / target) * 100;

    if (direction === 'below') {
        if (price <= target) return { class: 'status-alert', text: '已跌破' };
        if (diffPct < 0.01) return { class: 'status-warning', text: '临界' };
        return { class: 'status-safe', text: '安全' };
    } else if (direction === 'above') {
        if (price >= target) return { class: 'status-alert', text: '已涨破' };
        if (diffPct > -0.01) return { class: 'status-warning', text: '临界' };
        return { class: 'status-safe', text: '安全' };
    } else {
        if (price <= target || price >= target) return { class: 'status-alert', text: '已触发' };
        if (Math.abs(diffPct) < 0.01) return { class: 'status-warning', text: '临界' };
        return { class: 'status-safe', text: '安全' };
    }
}

// ============================================================
// 实时行情
// ============================================================

async function refreshQuotes() {
    const result = await apiCall('/api/quotes');
    if (result.success) {
        window.quotesCache = result.data;
        renderStockCards();
        renderConfigTable();
        document.getElementById('lastUpdate').textContent = '最后更新: ' + result.timestamp;
    }
}

function renderStockCards() {
    const container = document.getElementById('stockCards');
    if (!currentConfig || !currentConfig.alerts) return;

    // 按股票代码分组，只显示每个股票一次
    const uniqueStocks = {};
    currentConfig.alerts.forEach(item => {
        if (!uniqueStocks[item.code]) {
            uniqueStocks[item.code] = item;
        }
    });

    container.innerHTML = Object.values(uniqueStocks).map(item => {
        const quote = window.quotesCache[item.code];
        if (!quote) {
            return `
                <div class="quote-card">
                    <div class="q-name">${item.name || item.code}</div>
                    <div class="q-price stock-flat">--</div>
                    <div class="q-change stock-flat">等待数据...</div>
                </div>
            `;
        }

        const price = quote.price;
        const changePct = quote.changePct;
        const priceClass = getPriceClass(changePct);

        // 检查是否触发预警
        const alertItems = currentConfig.alerts.filter(a => a.code === item.code);
        let hasAlert = false;
        for (const ai of alertItems) {
            const s = getStatus(ai, quote);
            if (s.class === 'status-alert') { hasAlert = true; break; }
        }
        const cardClass = hasAlert ? 'quote-card alert-active' : 'quote-card';

        return `
            <div class="${cardClass}">
                <div class="q-name">${quote.name || item.name || item.code}</div>
                <div class="q-price ${priceClass}">¥${formatPrice(price)}</div>
                <div class="q-change ${priceClass}">${formatChange(changePct)}</div>
                <div class="q-target">目标: ¥${formatPrice(item.target)}</div>
            </div>
        `;
    }).join('');
}

// ============================================================
// 监控控制
// ============================================================

async function checkMonitorStatus() {
    const result = await apiCall('/api/monitor/status');
    if (result.success) {
        updateMonitorUI(result.data);
    }
}

async function startMonitor() {
    const result = await apiCall('/api/monitor/start', 'POST');
    if (result.success) {
        showToast('监控已启动', 'success');
        checkMonitorStatus();
    } else {
        showToast('启动失败: ' + (result.error || '未知错误'), 'danger');
    }
}

async function stopMonitor() {
    const result = await apiCall('/api/monitor/stop', 'POST');
    if (result.success) {
        showToast('监控已停止', 'warning');
        checkMonitorStatus();
    } else {
        showToast('停止失败: ' + (result.error || '未知错误'), 'danger');
    }
}

function updateMonitorUI(data) {
    monitorRunning = data.running;

    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('monitorStatusText');
    const btnStart = document.getElementById('btnStart');
    const btnStop = document.getElementById('btnStop');
    const uptimeEl = document.getElementById('uptime');

    if (data.running) {
        statusDot.className = 'status-dot running';
        statusText.textContent = '运行中';
        btnStart.disabled = true;
        btnStop.disabled = false;
        uptimeEl.textContent = data.uptime || '--:--:--';
    } else {
        statusDot.className = 'status-dot stopped';
        statusText.textContent = '已停止';
        btnStart.disabled = false;
        btnStop.disabled = true;
        uptimeEl.textContent = '--:--:--';
    }

    // 更新节点显示
    if (data.current_node) {
        updateCurrentNodeDisplay(data.current_node);
    }
}

// ============================================================
// SSE预警流
// ============================================================

function connectAlertStream() {
    if (eventSource) {
        eventSource.close();
    }

    eventSource = new EventSource('/api/alerts/stream');

    eventSource.onmessage = function(event) {
        try {
            const alert = JSON.parse(event.data);
            addAlertToLog(alert);
        } catch (e) {
            console.error('Failed to parse alert:', e);
        }
    };

    eventSource.onerror = function() {
        console.log('SSE connection error, reconnecting in 5s...');
        setTimeout(connectAlertStream, 5000);
    };
}

function addAlertToLog(alert) {
    const logContainer = document.getElementById('alertLog');

    // 移除"等待预警事件"提示
    const emptyMsg = logContainer.querySelector('.alert-heartbeat');
    if (emptyMsg) emptyMsg.remove();

    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert-item';
    alertDiv.innerHTML = `
        <span class="alert-time">[${alert.time}]</span>
        <span class="alert-message">${alert.message}</span>
    `;

    // 添加到顶部
    logContainer.insertBefore(alertDiv, logContainer.firstChild);

    // 限制日志数量
    while (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

async function clearAlerts() {
    await apiCall('/api/alerts/clear', 'POST');
    const logContainer = document.getElementById('alertLog');
    logContainer.innerHTML = '<div class="alert-heartbeat">等待预警事件...</div>';
    showToast('日志已清空', 'info');
}

// ============================================================
// 股票管理
// ============================================================

function addStock() {
    const code = document.getElementById('addCode').value.trim();
    const name = document.getElementById('addName').value.trim();
    const target = parseFloat(document.getElementById('addTarget').value);
    const direction = document.getElementById('addDirection').value;

    if (!code || !target) {
        showToast('请填写股票代码和目标价格', 'warning');
        return;
    }

    // 验证代码格式
    if (!/^(sh|sz)\d{6}$/.test(code)) {
        showToast('股票代码格式错误，应为 sh+6位数字 或 sz+6位数字', 'warning');
        return;
    }

    // 检查是否已存在
    if (currentConfig.alerts.some(a => a.code === code)) {
        showToast('该股票已在监控列表中', 'warning');
        return;
    }

    const newStock = {
        code,
        name: name || code,
        target,
        dir: direction
    };

    currentConfig.alerts.push(newStock);
    saveConfig(currentConfig);

    // 清空表单并关闭模态框
    document.getElementById('addStockForm').reset();
    bootstrap.Modal.getInstance(document.getElementById('addStockModal')).hide();
}

function editStock(index) {
    const stock = currentConfig.alerts[index];
    document.getElementById('editIndex').value = index;
    document.getElementById('editCode').value = stock.code;
    document.getElementById('editName').value = stock.name || '';
    document.getElementById('editTarget').value = stock.target;
    document.getElementById('editDirection').value = stock.dir || 'below';

    const modal = new bootstrap.Modal(document.getElementById('editStockModal'));
    modal.show();
}

function saveEdit() {
    const index = parseInt(document.getElementById('editIndex').value);
    const name = document.getElementById('editName').value.trim();
    const target = parseFloat(document.getElementById('editTarget').value);
    const direction = document.getElementById('editDirection').value;

    if (!target) {
        showToast('请填写目标价格', 'warning');
        return;
    }

    currentConfig.alerts[index].name = name || currentConfig.alerts[index].code;
    currentConfig.alerts[index].target = target;
    currentConfig.alerts[index].dir = direction;

    saveConfig(currentConfig);

    bootstrap.Modal.getInstance(document.getElementById('editStockModal')).hide();
}

function deleteStock() {
    const index = parseInt(document.getElementById('editIndex').value);
    const stock = currentConfig.alerts[index];

    if (confirm(`确定要删除 ${stock.name || stock.code} 吗？`)) {
        currentConfig.alerts.splice(index, 1);
        saveConfig(currentConfig);
        bootstrap.Modal.getInstance(document.getElementById('editStockModal')).hide();
    }
}

// ============================================================
// 节点管理
// ============================================================

async function loadNodes() {
    const result = await apiCall('/api/nodes');
    if (result.success) {
        renderNodeList(result.data.nodes);
        updateCurrentNodeDisplay(result.data.current);
    }
}

function renderNodeList(nodes) {
    const nodeList = document.getElementById('nodeList');
    nodeList.innerHTML = nodes.map(node => `
        <li>
            <a class="dropdown-item d-flex justify-content-between align-items-center ${node.is_current ? 'active' : ''} ${!node.is_available ? 'text-muted' : ''}"
               href="#" onclick="switchNode('${node.id}')">
                <span>
                    <i class="bi bi-geo-alt"></i> ${node.name}
                    <small class="text-muted">(${node.host})</small>
                </span>
                <span>
                    ${node.is_current ? '<i class="bi bi-check-circle-fill text-success"></i>' : ''}
                    ${!node.is_available ? '<i class="bi bi-x-circle-fill text-danger"></i>' : ''}
                </span>
            </a>
        </li>
    `).join('');
}

function updateCurrentNodeDisplay(node) {
    if (node && node.name) {
        document.getElementById('currentNodeName').textContent = node.name;
    }
}

async function switchNode(nodeId) {
    const result = await apiCall('/api/nodes/switch', 'POST', { node_id: nodeId });
    if (result.success) {
        showToast(`已切换到 ${result.node.name}`, 'success');
        loadNodes(); // 刷新节点列表
    } else {
        showToast('切换失败: ' + (result.error || '未知错误'), 'danger');
    }
}

// ============================================================
// 工具函数
// ============================================================

function formatPrice(price) {
    if (price === null || price === undefined || price === '--') return '--';
    return parseFloat(price).toFixed(2);
}

function formatChange(changePct) {
    if (changePct === null || changePct === undefined) return '--';
    const sign = changePct >= 0 ? '+' : '';
    return `${sign}${parseFloat(changePct).toFixed(2)}%`;
}

function getPriceClass(changePct) {
    if (changePct === null || changePct === undefined) return 'stock-flat';
    if (changePct > 0) return 'stock-up';
    if (changePct < 0) return 'stock-down';
    return 'stock-flat';
}

function showToast(message, type = 'info') {
    // 创建toast容器（如果不存在）
    let toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toastContainer';
        toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(toastContainer);
    }

    const toastId = 'toast_' + Date.now();
    const toastHtml = `
        <div id="${toastId}" class="toast align-items-center text-white bg-${type} border-0" role="alert">
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    `;

    toastContainer.insertAdjacentHTML('beforeend', toastHtml);

    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement, { delay: 3000 });
    toast.show();

    // 自动移除
    toastElement.addEventListener('hidden.bs.toast', () => {
        toastElement.remove();
    });
}
