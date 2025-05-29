// 节点数据
// 全局变量，将由后端填充或通过API获取
let nodeData = [];

// 当前选中的节点ID
let selectedNodeId = null;

// Fit transform parameters
let baseScale = 1;
let initialTranslateX = 0;
let initialTranslateY = 0;
let contentMinX = 0;
let contentMinY = 0;

// 深层选择模式
let isDeepSelectionMode = true; // 默认开启深层选择

// 全局变量
let socket = null;  // WebSocket连接
let isConnected = false;  // 设备连接状态
let isCapturing = false;  // 是否正在自动捕获

// DOM 元素引用
let deviceList = null;
let connectionStatus = null;
let statusIndicator = null;
let disconnectBtn = null;
let captureNowBtn = null;
let saveCaptureBtn = null;
let startAutoBtn = null;
let stopAutoBtn = null;
let refreshIntervalSlider = null;
let intervalValue = null;
let deviceScreenshot = null;
let loadingIndicator = null;

// 初始化页面
document.addEventListener('DOMContentLoaded', function() {
    console.log("页面已加载，初始化中...");
    
    // 获取DOM元素引用
    deviceList = document.getElementById('device-list');
    connectionStatus = document.getElementById('connection-status');
    statusIndicator = document.querySelector('.status-indicator');
    disconnectBtn = document.getElementById('disconnect');
    captureNowBtn = document.getElementById('capture-now');
    saveCaptureBtn = document.getElementById('save-capture');
    startAutoBtn = document.getElementById('start-auto');
    stopAutoBtn = document.getElementById('stop-auto');
    refreshIntervalSlider = document.getElementById('refresh-interval');
    intervalValue = document.getElementById('interval-value');
    deviceScreenshot = document.getElementById('device-screenshot');
    loadingIndicator = document.getElementById('loading-indicator');
    
    // 初始化WebSocket连接
    initSocketConnection();
    
    // 初始化UI控件
    initUIControls();
    
    // 加载设备列表
    refreshDeviceList();
    
    // 更新状态
    updateStatus();
    
    // 初始化手机屏幕
    initPhoneScreen();
});

// 切换深层选择模式
function toggleDeepSelectionMode() {
    isDeepSelectionMode = document.getElementById('deepSelectionMode').checked;
    console.log(`深层选择模式: ${isDeepSelectionMode ? '开启' : '关闭'}`);
    
    // 更新点击事件处理
    initClickHandlers();
}

// 递归生成节点数据数组，用于JavaScript访问
function processNodeData() {
    // 检查节点数据是否有效
    if (!nodeData || nodeData.length === 0) {
        console.error("节点数据为空");
        return;
    }
    
    // 修复bounds解析问题
    nodeData.forEach(node => {
        const bounds = node.bounds;
        // 确保bounds是有效的数字
        if (isNaN(bounds.x1)) bounds.x1 = 0;
        if (isNaN(bounds.y1)) bounds.y1 = 0;
        if (isNaN(bounds.x2)) bounds.x2 = 0;
        if (isNaN(bounds.y2)) bounds.y2 = 0;
        
        // 如果节点的bounds是[0,0][0,0]，尝试从attributes中解析
        if (bounds.x1 === 0 && bounds.y1 === 0 && bounds.x2 === 0 && bounds.y2 === 0) {
            const boundsStr = node.attributes.bounds;
            if (boundsStr) {
                try {
                    // 尝试解析 [x1,y1][x2,y2] 格式
                    const matches = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
                    if (matches && matches.length >= 5) {
                        bounds.x1 = parseInt(matches[1]);
                        bounds.y1 = parseInt(matches[2]);
                        bounds.x2 = parseInt(matches[3]);
                        bounds.y2 = parseInt(matches[4]);
                    }
                } catch (e) {
                    console.error("解析bounds失败:", boundsStr, e);
                }
            }
        }
    });
    
    console.log("节点数据处理完成");
}
    
// 初始化手机屏幕
function initPhoneScreen() {
    console.log("初始化手机屏幕...");
    const phoneScreen = document.getElementById('phoneScreen');
    const contentWrapper = document.getElementById('contentWrapper');
    contentWrapper.innerHTML = ''; // Clear previous content

    if (!nodeData || nodeData.length === 0) {
        console.error("节点数据为空，无法初始化");
        createExampleElements(phoneScreen); // Pass phoneScreen to example elements
        return;
    }
    
    processNodeData(); // Ensure bounds are parsed
    
    calculateAndApplyFitTransform(); // Calculate baseScale, initialTranslateX/Y, contentMinX/Y
    
    console.log(`共有 ${nodeData.length} 个节点数据`);
    console.log("节点bounds信息 (first 5):");
    nodeData.slice(0, 5).forEach(node => {
        console.log(`节点 ${node.id}: bounds=${JSON.stringify(node.bounds)}, type=${node.type}`);
    });

    renderAllElements(); // This will now use contentMinX/Y and append to contentWrapper

    if (contentWrapper.childElementCount === 0 && nodeData.length === 0) {
        console.warn("没有节点数据，创建示例元素");
        createExampleElements(phoneScreen);
    }
    
    // 直接应用变换，不再通过 zoomScreen
    const effectiveScale = baseScale; // 使用 baseScale 作为有效缩放比例
    contentWrapper.style.transform = `translate(${initialTranslateX}px, ${initialTranslateY}px) scale(${effectiveScale})`;
    console.log(`Initial transform applied. EffectiveScale: ${effectiveScale}, Translate: [${initialTranslateX}px, ${initialTranslateY}px]`);
    // 缩放后重新初始化点击处理器
    setTimeout(initClickHandlers, 100);
}

function calculateAndApplyFitTransform() {
    console.log("Calculating fit transform...");
    if (!nodeData || nodeData.length === 0) {
        console.warn("No node data to calculate fit transform.");
        // Default values if no data
        contentMinX = 0;
        contentMinY = 0;
        baseScale = 0.3; 
        initialTranslateX = 0;
        initialTranslateY = 0;
        return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasValidBounds = false;

    nodeData.forEach(node => {
        const b = node.bounds;
        const width = b.x2 - b.x1;
        const height = b.y2 - b.y1;

        let isRenderable = true;
        if (width <= 0 || height <= 0) {
            isRenderable = false;
        }
        // Filter out the huge root 'hierarchy' node if it's not meant to be drawn directly
        // This matches the filter in addElementToScreen
        if (node.id === "0" && (width > 1080 * 1.1 || height > 2400 * 1.1)) {
                isRenderable = false;
        }

        if (isRenderable) {
            minX = Math.min(minX, b.x1);
            minY = Math.min(minY, b.y1);
            maxX = Math.max(maxX, b.x2);
            maxY = Math.max(maxY, b.y2);
            hasValidBounds = true;
        }
    });

    if (!hasValidBounds) {
        console.warn("No valid element bounds found to calculate fit. Defaulting.");
        contentMinX = 0;
        contentMinY = 0;
        baseScale = 0.3; // Default scale if no content
        initialTranslateX = 0;
        initialTranslateY = 0;
        return;
    }

    contentMinX = minX;
    contentMinY = minY;
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    if (contentWidth <= 0 || contentHeight <= 0) {
        console.warn("Content width or height is zero. Defaulting scale.");
        baseScale = 0.3; // Default scale
        initialTranslateX = 0;
        initialTranslateY = 0;
        // Position at 0,0 relative to contentMinX, contentMinY
        return;
    }

    const phoneScreen = document.getElementById('phoneScreen');
    const phoneScreenWidth = phoneScreen.clientWidth;
    const phoneScreenHeight = phoneScreen.clientHeight;

    if (phoneScreenWidth <= 0 || phoneScreenHeight <= 0) {
        console.warn("Phone screen dimensions are zero. Cannot calculate fit.");
        baseScale = 0.3; // Default scale
        initialTranslateX = 0;
        initialTranslateY = 0;
        return;
    }
    
    const scaleX = phoneScreenWidth / contentWidth;
    const scaleY = phoneScreenHeight / contentHeight;
    baseScale = Math.min(scaleX, scaleY);

    // Prevent extremely small or large scales
    if (baseScale < 0.01) baseScale = 0.01;
    if (baseScale > 10) baseScale = 10;


    const scaledContentWidth = contentWidth * baseScale;
    const scaledContentHeight = contentHeight * baseScale;

    initialTranslateX = (phoneScreenWidth - scaledContentWidth) / 2;
    initialTranslateY = (phoneScreenHeight - scaledContentHeight) / 2;

    console.log(`Content bounds: [${minX},${minY}]-[${maxX},${maxY}], WxH: ${contentWidth}x${contentHeight}`);
    console.log(`Phone screen: WxH: ${phoneScreenWidth}x${phoneScreenHeight}`);
    console.log(`Fit params: baseScale=${baseScale}, initialTranslateX=${initialTranslateX}, initialTranslateY=${initialTranslateY}, contentMinX=${contentMinX}, contentMinY=${contentMinY}`);
}

// 创建示例元素
function createExampleElements(parentElement) {
    const contentWrapper = document.getElementById('contentWrapper'); // Use contentWrapper for elements
    
    // 添加一个示例标题栏
    const titleBar = document.createElement('div');
    titleBar.className = 'ui-element with-text';
    titleBar.style.left = '0px';
    titleBar.style.top = '0px';
    titleBar.style.width = '100%'; // Make it span the parent
    titleBar.style.height = '80px';
    titleBar.style.zIndex = '100';
    titleBar.textContent = '示例界面 (无有效XML内容)';
    titleBar.style.backgroundColor = 'lightgray';
    titleBar.style.position = 'absolute'; // Position relative to parentElement
    parentElement.appendChild(titleBar);
    
    // 添加一个示例按钮
    const button = document.createElement('div');
    button.className = 'ui-element clickable';
    button.style.left = 'calc(50% - 140px)'; // Center it
    button.style.top = '200px';
    button.style.width = '280px';
    button.style.height = '80px';
    button.style.zIndex = '100';
    button.textContent = '示例按钮';
    button.style.backgroundColor = 'lightcoral';
    button.style.position = 'absolute';
    parentElement.appendChild(button);
    
    // 添加一个示例文本框
    const textBox = document.createElement('div');
    textBox.className = 'ui-element with-text';
    textBox.style.left = '10%';
    textBox.style.top = '400px';
    textBox.style.width = '80%';
    textBox.style.height = '150px';
    textBox.style.zIndex = '100';
    textBox.innerHTML = '这是一个示例文本区域<br>UI元素未能正确渲染或XML为空';
    textBox.style.backgroundColor = 'lightgoldenrodyellow';
    textBox.style.position = 'absolute';
    parentElement.appendChild(textBox);
    
    console.log("已添加三个示例元素到指定的父元素");
}

// 渲染所有UI元素
function renderAllElements() {
    const contentWrapper = document.getElementById('contentWrapper');
    contentWrapper.innerHTML = '';
    console.log("开始渲染UI元素...");
    
    let addedElements = 0;
    
    // 按深度对节点排序，确保父节点先被添加
    const sortedNodes = [...nodeData].sort((a, b) => {
        return a.id.split('-').length - b.id.split('-').length;
    });
    
    // 添加所有元素
    for (const node of sortedNodes) {
        if (addElementToScreen(node)) {
            addedElements++;
        }
    }
    
    console.log(`成功添加了 ${addedElements} 个UI元素`);
    
    // 如果没有添加任何元素，输出所有节点的bounds信息以便调试
    if (addedElements === 0) {
        console.warn("没有添加任何元素，输出节点bounds信息:");
        nodeData.forEach(node => {
            const bounds = node.bounds;
            console.log(`节点 ${node.id}: bounds=[${bounds.x1},${bounds.y1}][${bounds.x2},${bounds.y2}], 类型=${node.type}`);
        });
    }
}

// 将一个元素添加到屏幕
function addElementToScreen(node) {
    try {
        // const phoneScreen = document.getElementById('phoneScreen'); // Old
        const contentWrapper = document.getElementById('contentWrapper'); // New
        const bounds = node.bounds;
        
        // 忽略大小为0的元素
        if (bounds.x1 === bounds.x2 || bounds.y1 === bounds.y2) {
            return false;
        }
        
        // 忽略过大的元素（可能是根元素, e.g. the hierarchy node itself)
        const width = bounds.x2 - bounds.x1;
        const height = bounds.y2 - bounds.y1;
        // Adjust threshold if needed, 1080x2400 is a common screen size
        if (node.id === "0" && (width > 1080 * 1.05 || height > 2400 * 1.05)) { 
            // console.log(`Skipping large root-like element ${node.id} with bounds: ${JSON.stringify(bounds)}`);
            return false;
        }
        if (width <= 0 || height <= 0) return false;


        const element = document.createElement('div');
        element.id = 'ui-element-' + node.id;
        element.className = 'ui-element'; // Base class
        element.dataset.nodeId = node.id; // 添加data属性存储nodeId，方便事件处理
        
        // Determine primary type for styling (text, image, clickable)
        let primaryType = node.type; // From Python: 'text', 'image', 'clickable', 'default'

        if (primaryType === 'text') {
            element.classList.add('with-text');
            // 不显示文本内容，只保留结构框
        } else if (primaryType === 'image') {
            element.classList.add('image');
            // 不显示图片SVG，只保留结构框
        } else if (primaryType === 'clickable') {
            element.classList.add('clickable');
        }
        // If node.type is 'default', it will use the base .ui-element styles

        element.style.left = (bounds.x1 - contentMinX) + 'px';
        element.style.top = (bounds.y1 - contentMinY) + 'px';
        element.style.width = width + 'px';
        element.style.height = height + 'px';
        
        const depth = node.id.split('-').length;
        element.style.zIndex = depth * 10;

        // 只设置工具提示，不显示内容
        if (node.attributes.text && node.attributes.text.trim()) {
            const text = node.attributes.text.trim();
            element.title = text; // 保留工具提示
            // 不设置textContent，只保留框
        } else if (node.attributes['content-desc'] && node.attributes['content-desc'].trim()) {
            const desc = node.attributes['content-desc'].trim();
            element.title = desc; // 保留工具提示
            // 不设置textContent，只保留框
        }

        // 不显示图片SVG占位符
        // if (primaryType === 'image' && !contentSet) {
        //     element.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';
        // } else if (!contentSet && (width < 20 || height < 20)) {
        //     element.textContent = '';
        // }

        // Opacity for containers with many children (visual cue for nesting)
        if (node.childCount > 10 && width * height > 10000) { // Apply only to reasonably large containers
            element.style.opacity = '0.5';
        } else if (node.childCount > 0 && width * height > 5000) {
            element.style.opacity = '0.75';
        }
        
        contentWrapper.appendChild(element); // Append to contentWrapper
        return true;
    } catch (error) {
        console.error(`添加元素 ${node.id} 时出错:`, error, node);
        return false;
    }
}

// 显示/隐藏所有元素
function toggleAllElements() {
    const showAll = document.getElementById('showAllElements').checked;
    const elements = document.querySelectorAll('.ui-element');
    
    elements.forEach(element => {
        if (showAll) {
            element.style.display = '';
        } else if (!element.classList.contains('selected')) {
            element.style.display = 'none';
        }
    });
}

// 隐藏/显示重叠元素
function toggleHideOverlap() {
    const hideOverlap = document.getElementById('hideOverlap').checked;
    if (!hideOverlap) {
        renderAllElements();
        if (selectedNodeId) {
            highlightElement(selectedNodeId);
        }
        return;
    }
    
    // 获取所有可见的元素
    const visibleElements = Array.from(document.querySelectorAll('.ui-element'))
        .filter(el => el.style.display !== 'none');
    
    // 对元素按面积从小到大排序
    visibleElements.sort((a, b) => {
        const areaA = a.offsetWidth * a.offsetHeight;
        const areaB = b.offsetWidth * b.offsetHeight;
        return areaA - areaB;
    });
    
    // 检查元素是否重叠
    const overlapping = new Set();
    for (let i = 0; i < visibleElements.length; i++) {
        for (let j = i + 1; j < visibleElements.length; j++) {
            if (checkOverlap(visibleElements[i], visibleElements[j])) {
                overlapping.add(visibleElements[j]);
            }
        }
    }
    
    // 隐藏重叠的元素
    overlapping.forEach(element => {
        if (!element.classList.contains('selected')) {
            element.style.display = 'none';
        }
    });
}

// 检查两个元素是否重叠
function checkOverlap(el1, el2) {
    const rect1 = el1.getBoundingClientRect();
    const rect2 = el2.getBoundingClientRect();
    
    return !(
        rect1.right < rect2.left ||
        rect1.left > rect2.right ||
        rect1.bottom < rect2.top ||
        rect1.top > rect2.bottom
    );
}

// 高亮显示元素
function highlightElement(nodeId) {
    // 移除之前的高亮
    document.querySelectorAll('.ui-element.selected').forEach(el => {
        el.classList.remove('selected');
        el.style.border = '';
        el.style.backgroundColor = '';
        el.style.zIndex = '';
    });
    
    // 高亮当前元素
    const element = document.getElementById('ui-element-' + nodeId);
    if (element) {
        element.classList.add('selected');
        element.style.display = '';
        
        // 增强高亮效果
        const originalBorder = element.style.border;
        const originalBg = element.style.backgroundColor;
        const originalZIndex = element.style.zIndex;
        
        // 设置临时的强烈高亮样式
        element.style.border = '3px solid red';
        element.style.backgroundColor = 'rgba(255, 100, 100, 0.4)';
        element.style.zIndex = '10000';
        
        // 保存到元素的dataset，以便clearSelection可以正确恢复
        element.dataset.originalBorder = originalBorder;
        element.dataset.originalBg = originalBg;
        element.dataset.originalZIndex = originalZIndex;
        
        // 显示一条提示信息
        console.log(`已高亮元素: ${nodeId}，请查看红色高亮的元素`);
        
        // 2秒后恢复原来的样式，但保留'selected'类
        setTimeout(() => {
            if (element) {
                element.style.border = originalBorder;
                element.style.backgroundColor = originalBg;
                element.style.zIndex = originalZIndex;
            }
        }, 2000);
    }
}

// 显示节点详情
function showNodeDetails(nodeId) {
    selectedNodeId = nodeId;
    const nodeDetails = document.getElementById('nodeDetails');
    const node = nodeData.find(n => n.id === nodeId.toString());
    
    if (!node) {
        nodeDetails.innerHTML = '<h2>错误</h2><p>找不到节点信息</p>';
        console.error(`找不到节点信息: ${nodeId}`);
        return;
    }
    
    console.log(`显示节点详情: ${nodeId}, 类型: ${node.type}`);
    
    // 高亮选中的节点
    document.querySelectorAll('.highlight').forEach(el => {
        el.classList.remove('highlight');
    });
    
    // 查找树中的节点并展开，并滚动到该节点
    setTimeout(() => {
        // 先尝试展开到该节点并滚动
        expandToNode(nodeId, true); // 设置为 true 以允许滚动
        
        // 再次检查，确保找到并高亮
        const treeNode = findTreeNodeById(nodeId);
        if (treeNode) {
            treeNode.classList.add('highlight');
        } else {
            console.warn(`在树中找不到节点: ${nodeId}`);
        }
    }, 100);
    
    // 高亮屏幕上的元素
    highlightElement(nodeId);
    
    // 添加关闭按钮和标题栏
    let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h2>${node.tag} 节点详情</h2>
            <button onclick="clearSelection()" style="cursor: pointer; background-color: #f0f0f0; border: 1px solid #ccc; border-radius: 4px; padding: 4px 10px;">关闭 ✕</button>
        </div>
    `;
    
    // 显示预览
    const bounds = node.bounds;
    const width = bounds.x2 - bounds.x1;
    const height = bounds.y2 - bounds.y1;
    
    html += `
        <div class="node-preview">
            <h3>UI 元素预览</h3>
            <p>位置: [${bounds.x1}, ${bounds.y1}] - [${bounds.x2}, ${bounds.y2}]</p>
            <p>尺寸: ${width} x ${height} 像素</p>
        </div>
    `;
    
    // 添加XPath功能区域
    html += `
        <div class="xpath-section">
            <h3>XPath 获取</h3>
            <div class="xpath-controls">
                <button onclick="getSimpleXPath('${nodeId}')" class="xpath-btn">获取简单XPath</button>
                <button onclick="getFullXPath('${nodeId}')" class="xpath-btn">获取完整XPath</button>
            </div>
            <div class="xpath-result">
                <textarea id="xpathResult" readonly placeholder="点击上方按钮获取XPath"></textarea>
                <button onclick="copyXPath()" class="copy-btn" title="复制到剪贴板">复制</button>
            </div>
        </div>
    `;
    
    // 显示属性表格
    html += `
        <h3>属性</h3>
        <table class="attribute-table">
            <tr>
                <th>属性名</th>
                <th>值</th>
            </tr>
    `;
    
    for (const [key, value] of Object.entries(node.attributes)) {
        html += `
            <tr>
                <td>${key}</td>
                <td>${value}</td>
            </tr>
        `;
    }
    
    html += '</table>';
    nodeDetails.innerHTML = html;
}

// 获取简单XPath (相对路径)
function getSimpleXPath(nodeId) {
    const node = nodeData.find(n => n.id === nodeId.toString());
    if (!node) return;
    
    // 构建简单XPath，优先使用resource-id属性
    let xpath = '';
    
    if (node.tag) {
        xpath = `//${node.tag}`;
        
        // 首先使用resource-id属性（如果存在）
        if (node.attributes['resource-id']) {
            xpath += `[@resource-id="${node.attributes['resource-id']}"]`;
        }
        // 然后尝试text属性
        else if (node.attributes.text && node.attributes.text.trim()) {
            xpath += `[@text="${node.attributes.text.trim()}"]`;
        }
        // 然后尝试content-desc属性
        else if (node.attributes['content-desc'] && node.attributes['content-desc'].trim()) {
            xpath += `[@content-desc="${node.attributes['content-desc'].trim()}"]`;
        }
        // 最后尝试class属性
        else if (node.attributes.class) {
            xpath += `[@class="${node.attributes.class}"]`;
        }
    }
    
    setXPathResult(xpath);
    return xpath;
}

// 获取完整XPath (绝对路径)
function getFullXPath(nodeId) {
    let cleanNodeId = nodeId;
    if (nodeId.startsWith('node-')) {
        cleanNodeId = nodeId.substring('node-'.length);
    }
    const parts = cleanNodeId.split('-');
    const xpath = buildFullXPath(parts);
    setXPathResult(xpath);
    return xpath;
}

// 递归构建完整XPath
function buildFullXPath(idParts, index = 0, currentPath = '') {
    console.log(`buildFullXPath - idParts: ${JSON.stringify(idParts)}, index: ${index}, currentPath: ${currentPath}`);

    if (index >= idParts.length) {
        console.log(`buildFullXPath - Reached end of idParts. Returning: ${currentPath}`);
        return currentPath;
    }
    
    // 构建在 nodeData 中实际查找的 ID (应为 "node-0", "node-0-0" 等格式)
    const currentIdInNodeData = "node-" + idParts.slice(0, index + 1).join('-');
    console.log(`buildFullXPath - currentId to find in nodeData: ${currentIdInNodeData}`);

    const node = nodeData.find(n => n.id === currentIdInNodeData);
    
    if (!node) {
        console.warn(`buildFullXPath - Node not found in nodeData for currentId: ${currentIdInNodeData}. Returning currentPath: ${currentPath}`);
        return currentPath;
    }
    console.log(`buildFullXPath - Found node: ${JSON.stringify(node.attributes)}, tag: ${node.tag}`);
    
    // 为当前节点添加XPath部分
    let currentSegment = '';
    if (index === 0) {
        // 根节点
        currentSegment = `/${node.tag}`;
        console.log(`buildFullXPath - Root segment: ${currentSegment}`);
    } else {
        // 子节点
        const childIndexString = idParts[index]; // e.g., "0", "1", "2"
        const childIndex = parseInt(childIndexString, 10);

        if (isNaN(childIndex)) {
            console.error(`buildFullXPath - Invalid childIndex: '${childIndexString}' is NaN. idParts: ${JSON.stringify(idParts)}, index: ${index}`);
            return currentPath; 
        }
        currentSegment = `/${node.tag}[${childIndex + 1}]`; // XPath索引从1开始
        console.log(`buildFullXPath - Child segment: ${currentSegment}, childIndex (0-based): ${childIndex}`);
    }
    
    // 递归构建完整路径
    return buildFullXPath(idParts, index + 1, currentPath + currentSegment);
}

// 设置XPath结果到文本框
function setXPathResult(xpath) {
    const resultField = document.getElementById('xpathResult');
    if (resultField) {
        resultField.value = xpath;
        resultField.select();
    }
}

// 复制XPath到剪贴板
function copyXPath() {
    const resultField = document.getElementById('xpathResult');
    if (resultField) {
        resultField.select();
        document.execCommand('copy');
        
        // 显示复制成功提示
        const oldValue = resultField.value;
        resultField.value = '复制成功!';
        setTimeout(() => {
            resultField.value = oldValue;
        }, 1000);
    }
}

// 添加代码来检查树的结构，以便调试
function debugTreeStructure() {
    console.log("调试树结构...");
    const treeContainer = document.querySelector('.tree-container');
    const detailsElements = treeContainer.querySelectorAll('details');
    const summaryElements = treeContainer.querySelectorAll('summary');
    
    console.log(`找到 ${detailsElements.length} 个details元素`);
    console.log(`找到 ${summaryElements.length} 个summary元素`);
    
    // 检查前5个details元素
    const sampleDetails = Array.from(detailsElements).slice(0, 5);
    sampleDetails.forEach(detail => {
        console.log(`Details ID: ${detail.id}, 开闭状态: ${detail.open}`);
    });
    
    // 检查前5个summary元素
    const sampleSummaries = Array.from(summaryElements).slice(0, 5);
    sampleSummaries.forEach(summary => {
        console.log(`Summary ID: ${summary.id}, 内容: ${summary.textContent.trim().substring(0, 30)}`);
    });
}

// 修改expandToNode函数，以适应实际的树结构
function expandToNode(nodeId, shouldScroll = true) {
    console.log(`尝试展开树到节点: ${nodeId}`);
    
    // 首先调试树结构
    debugTreeStructure();
    
    const parts = nodeId.split('-');
    
    // 首先，创建我们需要展开的所有节点ID的数组
    const pathIds = [];
    let currentId = parts[0];
    pathIds.push(currentId);
    
    for (let i = 1; i < parts.length; i++) {
        currentId += '-' + parts[i];
        pathIds.push(currentId);
    }
    
    console.log(`需要展开的路径: ${pathIds.join(' -> ')}`);
    
    // 尝试展开沿路径的每个节点
    for (let i = 0; i < pathIds.length - 1; i++) {
        const nodeElement = findTreeNodeById(pathIds[i]);
        if (nodeElement) {
            // 找出与此节点关联的details元素
            let parentDetails = nodeElement.closest('details');
            if (parentDetails) {
                console.log(`为节点${pathIds[i]}找到details元素: ${parentDetails.id}`);
                parentDetails.open = true;
            } else {
                console.log(`无法为节点${pathIds[i]}找到父details元素`);
            }
            
            // 继续向上查找所有父details元素
            let currentElement = nodeElement;
            while (currentElement && currentElement !== document.body) {
                currentElement = currentElement.parentElement;
                if (currentElement && currentElement.tagName.toLowerCase() === 'details') {
                    console.log(`找到上层details元素: ${currentElement.id}`);
                    currentElement.open = true;
                }
            }
        } else {
            console.log(`未找到节点元素: ${pathIds[i]}`);
        }
    }
    
    // 尝试找到并滚动到目标节点
    const targetNode = findTreeNodeById(nodeId);

    if (targetNode) {
        console.log(`expandToNode: 成功找到 targetNode:`, targetNode);
        console.log(`expandToNode: targetNode.id = ${targetNode.id}, targetNode.tagName = ${targetNode.tagName}, targetNode.className = ${targetNode.className}`);
        // 高亮节点
        document.querySelectorAll('.highlight').forEach(el => {
            el.classList.remove('highlight');
        });
        targetNode.classList.add('highlight');
        
        // 只有在shouldScroll为true时才滚动
        if (shouldScroll) {
            console.log("expandToNode: shouldScroll is true, 准备滚动。");
            // 确保节点可见
            setTimeout(() => {
                const treeContainer = document.querySelector('.tree-container');
                if (treeContainer && targetNode) {
                    console.log("expandToNode: treeContainer 和 targetNode 有效, 执行 scrollIntoView。");
                    targetNode.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center'
                    });
                    
                    // 添加闪烁效果
                    targetNode.style.animation = 'highlight-pulse 1s ease-in-out 2';
                    
                    // 确保有高亮动画样式
                    if (!document.getElementById('highlight-animation')) {
                        const style = document.createElement('style');
                        style.id = 'highlight-animation';
                        style.textContent = `
                            @keyframes highlight-pulse {
                                0% { background-color: #f0f0f0; }
                                50% { background-color: #ffcc80; }
                                100% { background-color: #f0f0f0; }
                            }
                        `;
                        document.head.appendChild(style);
                    }
                } else {
                    console.warn("expandToNode: treeContainer 或 targetNode 无效，无法滚动。", treeContainer, targetNode);
                }
            }, 300); // 增加延时确保DOM更新完成
        } else {
            console.log("expandToNode: shouldScroll is false, 不滚动。");
            // 只添加高亮效果，不滚动
            targetNode.style.animation = 'highlight-pulse 1s ease-in-out 2';
                    
            // 确保有高亮动画样式
            if (!document.getElementById('highlight-animation')) {
                const style = document.createElement('style');
                style.id = 'highlight-animation';
                style.textContent = `
                    @keyframes highlight-pulse {
                        0% { background-color: #f0f0f0; }
                        50% { background-color: #ffcc80; }
                        100% { background-color: #f0f0f0; }
                    }
                `;
                document.head.appendChild(style);
            }
        }
    } else {
        console.warn(`expandToNode: 无法找到目标节点 (targetNode is null): ${nodeId}`);
    }
}

// 检查元素是否完全在容器的可视区域内
function isElementFullyVisible(element, container) {
    if (!element || !container) return false;
    
    const elementRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    return (
        elementRect.top >= containerRect.top &&
        elementRect.bottom <= containerRect.bottom &&
        elementRect.left >= containerRect.left &&
        elementRect.right <= containerRect.right
    );
}

// 滚动节点到视图中
function scrollNodeIntoView(node) {
    if (!node) {
        console.error("无法滚动到节点，节点不存在");
        return;
    }
    
    const treeContainer = document.querySelector('.tree-container');
    if (!treeContainer) {
        console.error("无法滚动到节点，找不到树容器");
        return;
    }
    
    // 保存当前页面滚动位置，以便后续恢复
    const pageScrollPosition = {
        x: window.pageXOffset || document.documentElement.scrollLeft,
        y: window.pageYOffset || document.documentElement.scrollTop
    };
    
    try {
        // 计算节点相对于树容器的位置
        const nodeRect = node.getBoundingClientRect();
        const containerRect = treeContainer.getBoundingClientRect();
        
        // 检查节点是否已在可视区域内
        const isVisible = (
            nodeRect.top >= containerRect.top &&
            nodeRect.bottom <= containerRect.bottom
        );
        
        // 如果节点已经可见，就不需要滚动
        if (isVisible) {
            console.log("节点已在可视区域内，无需滚动");
            // 只添加高亮动画
            addHighlightAnimation(node);
            return;
        }
        
        console.log(`节点位置: top=${nodeRect.top}, bottom=${nodeRect.bottom}, 容器: top=${containerRect.top}, bottom=${containerRect.bottom}`);
        
        // 计算滚动位置，使节点出现在容器中间
        const scrollTop = treeContainer.scrollTop + (nodeRect.top - containerRect.top) - 
                         (containerRect.height / 2) + (nodeRect.height / 2);
        
        // 平滑滚动到目标位置
        treeContainer.scrollTo({
            top: scrollTop,
            behavior: 'smooth'
        });
        
        console.log(`滚动树容器到位置: ${scrollTop}`);
        
        // 添加高亮动画
        addHighlightAnimation(node);
        
    } catch (error) {
        console.error("滚动节点到视图时出错:", error);
    } finally {
        // 恢复页面滚动位置，确保主页面不变
        setTimeout(() => {
            window.scrollTo(pageScrollPosition.x, pageScrollPosition.y);
        }, 10);
    }
}

// 辅助函数：为节点添加高亮动画
function addHighlightAnimation(node) {
    // 添加视觉闪烁效果
    node.style.animation = 'highlight-pulse 1s ease-in-out 2';
    
    // 确保样式表中有对应的动画定义
    if (!document.getElementById('highlight-animation')) {
        const style = document.createElement('style');
        style.id = 'highlight-animation';
        style.textContent = `
            @keyframes highlight-pulse {
                0% { background-color: #f0f0f0; }
                50% { background-color: #ffcc80; }
                100% { background-color: #f0f0f0; }
            }
        `;
        document.head.appendChild(style);
    }
}

// 添加监听器以处理树节点的手动展开/收起
function setupTreeListeners() {
    console.log("设置树节点监听器 - 新版本（事件委托）");
    
    // 找到树的容器
    const treeContainer = document.querySelector('.tree-container');
    if (!treeContainer) {
        console.error("找不到树容器元素 (.tree-container)");
        return;
    }
    
    // 为树容器添加事件委托，处理所有子元素的点击
    treeContainer.addEventListener('click', function(event) {
        // 处理节点数量点击
        if (event.target.classList.contains('node-count')) {
            event.preventDefault();
            event.stopPropagation();
            
            // 获取关联的节点ID
            const nodeId = event.target.getAttribute('data-node-id');
            if (nodeId) {
                console.log(`节点数量被点击，显示节点详情: ${nodeId}`);
                showNodeDetails(nodeId);
            }
            return;
        }
        
        // 查找最近的summary元素
        const summary = event.target.closest('summary');
        if (!summary) {
            console.log("点击的不是summary元素或其子元素");
            return; // 不是点击summary或其内部元素
        }
        
        // 获取包含此summary的details元素
        const details = summary.parentElement;
        if (!details || details.tagName.toLowerCase() !== 'details') {
            console.error("找不到父details元素");
            return;
        }
        
        // 检测是否这个details元素已经被标记为manuallyClosed
        const wasManuallyClosed = details.dataset.manuallyClosed === "true";
        
        // 始终清除manuallyClosed标记，无论当前状态如何
        delete details.dataset.manuallyClosed;
        
        // 如果事件目标是summary元素本身，允许默认行为发生
        // 但是如果之前是手动关闭的，我们需要帮助它打开
        if (wasManuallyClosed && !details.open) {
            console.log(`手动打开之前被关闭的节点: ${summary.id || "未知"}`);
            
            // 停止事件传播，防止默认行为
            event.preventDefault();
            event.stopPropagation();
            
            // 强制打开details
            details.open = true;
            
            // 触发toggle事件以保持状态一致性
            try {
                const toggleEvent = new Event('toggle');
                details.dispatchEvent(toggleEvent);
            } catch(e) {
                console.error("触发toggle事件失败:", e);
            }
        }
    }, true); // 使用捕获阶段，确保在其他事件处理器之前处理
    
    // 仍然监听toggle事件以标记manuallyClosed状态
    document.querySelectorAll('.ui-tree details').forEach(detailsEl => {
        detailsEl.addEventListener('toggle', function(e) {
            if (!this.open) {
                this.dataset.manuallyClosed = "true";
                console.log(`节点被关闭，标记为manuallyClosed: ${this.querySelector('summary')?.id || this.id || '未知'}`);
            } else {
                delete this.dataset.manuallyClosed;
                console.log(`节点被打开，移除manuallyClosed标记: ${this.querySelector('summary')?.id || this.id || '未知'}`);
            }
        });
    });
    
    // 解决双击问题 - 防止双击收起/展开冲突
    document.querySelectorAll('.ui-tree summary').forEach(summaryEl => {
        summaryEl.addEventListener('dblclick', function(event) {
            event.preventDefault();
            event.stopPropagation();
            console.log("双击事件被拦截，防止收起/展开冲突");
            
            // 仍然允许显示节点详情
            const nodeId = this.id.substring(5); // 去掉'node-'前缀
            showNodeDetails(nodeId);
        });
    });
}

// 搜索功能
function searchNodes() {
    const searchText = document.getElementById('searchBox').value.toLowerCase();
    const allTreeElements = document.querySelectorAll('.ui-tree li'); // 获取所有的li元素

    allTreeElements.forEach(liElement => {
        const summaryElement = liElement.querySelector('summary');
        const spanElement = liElement.querySelector('span'); // 通常叶子节点是span
        let nodeText = '';

        if (summaryElement) {
            nodeText = summaryElement.textContent.toLowerCase();
        } else if (spanElement) {
            nodeText = spanElement.textContent.toLowerCase();
        } else {
            // 对于没有summary或span的li（理论上不应该），直接用li的文本
            nodeText = liElement.textContent.toLowerCase();
        }

        const isMatch = nodeText.includes(searchText);

        if (isMatch) {
            // 如果匹配，显示当前li
            liElement.style.display = '';
            // 并且展开所有父details元素，确保路径可见
            let parent = liElement.parentElement;
            while (parent && parent !== document.body) {
                if (parent.tagName.toLowerCase() === 'details') {
                    parent.open = true;
                }
                if (parent.tagName.toLowerCase() === 'li') { // 如果父元素也是li，也要显示它
                    parent.style.display = '';
                }
                parent = parent.parentElement;
            }
        } else {
            // 如果不匹配，并且搜索框有内容，则隐藏当前li
            if (searchText) {
                liElement.style.display = 'none';
            } else {
                // 如果搜索框为空，显示所有li (并确保所有details都根据其默认状态显示)
                liElement.style.display = '';
                // 注意：这里不改变details的open状态，除非它们因匹配而被打开
            }
        }
    });

    // 如果搜索框为空，确保所有顶层details元素都根据其存储的状态（或默认）显示
    if (!searchText) {
        document.querySelectorAll('.ui-tree > li > details').forEach(details => {
            // 这里可以添加逻辑来恢复details的原始展开状态，如果需要的话
            // 目前，如果它们被搜索打开，它们将保持打开状态，直到手动关闭
        });
    }
}

// 禁用页面自动滚动
function disableAutoScroll() {
    console.log("禁用页面自动滚动");
    
    // 监听全局滚动事件，记录当前位置
    let lastScrollPosition = {
        x: window.pageXOffset || document.documentElement.scrollLeft,
        y: window.pageYOffset || document.documentElement.scrollTop
    };
    
    // 当检测到页面滚动时，立即恢复到上一个位置
    window.addEventListener('scroll', function(e) {
        // 如果是用户手动滚动，允许滚动
        if (e.isTrusted && e.type === 'scroll' && e.target === document) {
            return;
        }
        
        // 检测是否是自动滚动
        const currentScrollY = window.pageYOffset || document.documentElement.scrollTop;
        const currentScrollX = window.pageXOffset || document.documentElement.scrollLeft;
        
        // 如果位置变化不是由用户操作引起的，恢复到上一个位置
        if (Math.abs(currentScrollY - lastScrollPosition.y) > 5 || 
            Math.abs(currentScrollX - lastScrollPosition.x) > 5) {
            console.log(`检测到自动滚动，从 Y:${lastScrollPosition.y} 到 Y:${currentScrollY}，恢复位置`);
            window.scrollTo(lastScrollPosition.x, lastScrollPosition.y);
        }
    }, true);
    
    // 记录用户手动滚动位置
    document.addEventListener('wheel', function() {
        lastScrollPosition = {
            x: window.pageXOffset || document.documentElement.scrollLeft,
            y: window.pageYOffset || document.documentElement.scrollTop
        };
    }, true);
    
    // 防止scrollIntoView引起的自动滚动
    // const originalScrollIntoView = Element.prototype.scrollIntoView;
    // Element.prototype.scrollIntoView = function(options) {
    //     // 仅允许树容器内的元素使用scrollIntoView
    //     const treeContainer = document.querySelector('.tree-container');
    //     if (this.closest('.tree-container')) {
    //         // 仅在树容器内滚动，而不是整个页面
    //         const container = this.closest('.tree-container');
    //         if (container) {
    //             const rect = this.getBoundingClientRect();
    //             const containerRect = container.getBoundingClientRect();
                
    //             if (options && options.block === 'center') {
    //                 container.scrollTop = (rect.top + container.scrollTop) - containerRect.top - (containerRect.height / 2) + (rect.height / 2);
    //             } else {
    //                 container.scrollTop = (rect.top + container.scrollTop) - containerRect.top;
    //             }
    //         }
    //     } else if (this.id === 'phoneScreen' || this.closest('#phoneScreen')) {
    //         // 阻止手机屏幕区域的滚动
    //         console.log("阻止手机屏幕区域的scrollIntoView");
    //         return;
    //     } else {
    //         // 其他元素使用原始的scrollIntoView
    //         originalScrollIntoView.apply(this, arguments);
    //     }
    // };
    
    console.log("自动滚动禁用完成 (scrollIntoView重写已注释)");
}

// 页面加载完成后初始化
window.onload = function() {
    console.log("页面加载完成，开始初始化...");
    
    // 禁用自动滚动
    disableAutoScroll();
    
    setTimeout(function() {
        try {
            initPhoneScreen();
            setupPhoneScreenClickHandler(); // 添加点击事件处理
            setupTreeListeners(); // 设置树节点监听器
            
            // 额外添加一个点击事件初始化函数
            setTimeout(initClickHandlers, 1000);
            
        } catch (error) {
            console.error("初始化失败:", error);
        }
    }, 500); // 延迟一小段时间确保DOM已完全加载
};

// 直接为所有UI元素添加点击处理
function initClickHandlers() {
    console.log("正在为所有UI元素添加点击事件处理...");
    
    const elements = document.querySelectorAll('.ui-element');
    console.log(`找到 ${elements.length} 个UI元素`);
    
    // 先移除所有之前可能添加的点击事件处理器
    elements.forEach(element => {
        element.removeEventListener('click', handleElementClick);
    });
    
    // 添加新的点击事件处理器
    elements.forEach(element => {
        element.addEventListener('click', handleElementClick);
    });
    
    // 确保取消选择按钮工作
    const clearButton = document.querySelector('button[onclick="clearSelection()"]');
    if (clearButton) {
        clearButton.removeEventListener('click', clearSelectionHandler);
        clearButton.addEventListener('click', clearSelectionHandler);
    }
    
    // 添加点击空白区域取消选择的处理
    const phoneScreen = document.getElementById('phoneScreen');
    const contentWrapper = document.getElementById('contentWrapper');
    
    phoneScreen.removeEventListener('click', handlePhoneScreenClick);
    phoneScreen.addEventListener('click', handlePhoneScreenClick);
    
    if (contentWrapper) {
        contentWrapper.removeEventListener('click', handleContentWrapperClick);
        contentWrapper.addEventListener('click', handleContentWrapperClick);
    }
    
    console.log("所有UI元素的点击事件处理器已添加");
}

// 处理元素点击的函数
function handleElementClick(e) {
    e.stopPropagation();
    e.preventDefault(); // 防止默认行为可能导致的页面滚动
    
    // 记录当前页面滚动位置
    const scrollPosition = {
        x: window.pageXOffset || document.documentElement.scrollLeft,
        y: window.pageYOffset || document.documentElement.scrollTop
    };
    
    if (isDeepSelectionMode || e.shiftKey) {
        // 深层选择模式或按住Shift键
        // 获取点击位置的所有元素
        findAndShowElementsAtPosition(e.clientX, e.clientY);
        
        // 恢复页面滚动位置
        setTimeout(() => {
            window.scrollTo(scrollPosition.x, scrollPosition.y);
        }, 50);
    } else {
        // 普通模式，直接选择当前元素
        const elementId = this.id;
        if (elementId && elementId.startsWith('ui-element-')) {
            const nodeId = elementId.substring('ui-element-'.length);
            console.log(`元素被点击: ${elementId}, nodeId: ${nodeId}, 深层选择模式: ${isDeepSelectionMode}`);
            
            // 显示节点详情
            showNodeDetails(nodeId);
            
            // 恢复页面滚动位置
            setTimeout(() => {
                window.scrollTo(scrollPosition.x, scrollPosition.y);
            }, 50);
        }
    }
}

// 处理手机屏幕点击的函数
function handlePhoneScreenClick(e) {
    // 只有当点击的是空白区域（phoneScreen本身或contentWrapper）才进行取消选择
    if (e.target === this || e.target.id === 'contentWrapper') {
        console.log("点击了手机屏幕空白区域，执行取消选择");
        clearSelection();
    }
}

// 处理内容包装器点击的函数
function handleContentWrapperClick(e) {
    // 只有当点击的是contentWrapper本身才进行取消选择
    if (e.target === this) {
        console.log("点击了内容包装器空白区域，执行取消选择");
        clearSelection();
    }
}

// 清除选择的事件处理函数
function clearSelectionHandler(e) {
    console.log("取消选择按钮被点击");
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    clearSelection();
}

// 添加点击事件到phone-screen，处理缩放和平移后的点击事件委托
function setupPhoneScreenClickHandler() {
    // 注意：主要的点击处理逻辑已移至initClickHandlers函数中的handlePhoneScreenClick和handleElementClick
    // 此函数保留以兼容现有代码，但核心功能已整合到统一的事件处理框架中
    console.log("setupPhoneScreenClickHandler被调用，但主要逻辑已移至initClickHandlers");
}

// 清除选择
function clearSelection() {
    console.log("执行取消选择...");
    
    try {
        // 移除所有高亮
        document.querySelectorAll('.ui-element.selected').forEach(el => {
            console.log(`清除元素高亮: ${el.id}`);
            el.classList.remove('selected');
            
            // 使用之前保存的原始样式（如果存在）
            if (el.dataset.originalBorder !== undefined) {
                el.style.border = el.dataset.originalBorder;
            } else {
                el.style.border = '';
            }
            
            if (el.dataset.originalBg !== undefined) {
                el.style.backgroundColor = el.dataset.originalBg;
            } else {
                el.style.backgroundColor = '';
            }
            
            if (el.dataset.originalZIndex !== undefined) {
                el.style.zIndex = el.dataset.originalZIndex;
            } else {
                el.style.zIndex = '';
            }
        });
        
        // 清除树中的高亮
        document.querySelectorAll('.highlight').forEach(el => {
            console.log(`清除树节点高亮: ${el.id}`);
            el.classList.remove('highlight');
        });
        
        // 清除当前选中ID
        const oldSelectedId = selectedNodeId;
        selectedNodeId = null;
        console.log(`选中ID从 ${oldSelectedId} 重置为 ${selectedNodeId}`);
        
        // 更新详情面板
        const nodeDetails = document.getElementById('nodeDetails');
        if (nodeDetails) {
            nodeDetails.innerHTML = `
                <h2>选择一个节点查看详情</h2>
                <p>在左侧树中点击任意节点或在手机预览中选择UI元素可查看其详细属性。</p>
                <p>使用"深层选择"功能可以选择嵌套的内层元素。</p>
            `;
            console.log("详情面板已重置");
        } else {
            console.error("找不到nodeDetails元素");
        }
        
        console.log("取消选择操作完成");
    } catch (error) {
        console.error("取消选择过程中出错:", error);
    }
    
    return false; // 防止事件传播
}

// 根据点击位置找出所有重叠的元素并显示选择菜单
function findAndShowElementsAtPosition(clientX, clientY) {
    const phoneScreen = document.getElementById('phoneScreen');
    const contentWrapper = document.getElementById('contentWrapper');
    const rect = phoneScreen.getBoundingClientRect();
    
    // 转换为phoneScreen内的相对坐标
    const phoneScreenX = clientX - rect.left;
    const phoneScreenY = clientY - rect.top;
    
    console.log(`点击位置: 客户端(${clientX}, ${clientY}), 屏幕内(${phoneScreenX}, ${phoneScreenY})`);
    
    // 计算缩放和平移后的内容区域坐标
    const scaledX = (phoneScreenX - initialTranslateX) / baseScale + contentMinX; // 使用 baseScale
    const scaledY = (phoneScreenY - initialTranslateY) / baseScale + contentMinY; // 使用 baseScale
    
    console.log(`转换后内容坐标: (${scaledX}, ${scaledY})`);
    
    // 找出所有包含这个点的元素 - 先深度遍历节点数据
    const matchedNodes = [];
    
    nodeData.forEach(node => {
        const bounds = node.bounds;
        if (bounds && 
            scaledX >= bounds.x1 && scaledX <= bounds.x2 && 
            scaledY >= bounds.y1 && scaledY <= bounds.y2) {
            matchedNodes.push(node);
        }
    });
    
    console.log(`找到 ${matchedNodes.length} 个重叠的元素`);
    
    if (matchedNodes.length === 0) {
        console.log("在点击位置未找到任何元素");
        return;
    } else if (matchedNodes.length === 1) {
        // 如果只有一个元素，直接显示详情
        showNodeDetails(matchedNodes[0].id);
        return;
    }
    
    // 按元素大小从小到大排序（面积越小，越可能是内层元素）
    matchedNodes.sort((a, b) => {
        const areaA = (a.bounds.x2 - a.bounds.x1) * (a.bounds.y2 - a.bounds.y1);
        const areaB = (b.bounds.x2 - b.bounds.x1) * (b.bounds.y2 - b.bounds.y1);
        return areaA - areaB;
    });
    
    // 创建并显示层级选择菜单
    showLayerSelectionMenu(matchedNodes, clientX, clientY);
}

// 显示层级选择菜单
function showLayerSelectionMenu(nodes, x, y) {
    const menu = document.getElementById('layerSelectionMenu');
    menu.innerHTML = '';
    
    // 创建菜单标题
    const title = document.createElement('div');
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '5px';
    title.style.borderBottom = '1px solid #ccc';
    title.textContent = `选择元素（从内到外）:`;
    menu.appendChild(title);
    
    // 添加每个节点选项
    nodes.forEach((node, index) => {
        const option = document.createElement('div');
        option.style.padding = '4px 8px';
        option.style.cursor = 'pointer';
        option.style.borderBottom = index < nodes.length - 1 ? '1px solid #eee' : 'none';
        
        // 确定显示文本
        let displayText = node.tag || 'unknown';
        if (node.attributes) {
            if (node.attributes.text && node.attributes.text.trim()) {
                displayText += `: "${node.attributes.text.trim()}"`;
            } else if (node.attributes.class) {
                displayText = node.attributes.class.split('.').pop();
            }
        }
        
        // 添加元素尺寸信息
        const width = node.bounds.x2 - node.bounds.x1;
        const height = node.bounds.y2 - node.bounds.y1;
        displayText += ` (${width}×${height})`;
        
        option.textContent = displayText;
        
        // 鼠标悬停效果
        option.onmouseover = function() {
            this.style.backgroundColor = '#f0f0f0';
            // 预览高亮相应元素
            const element = document.getElementById('ui-element-' + node.id);
            if (element) {
                element.style.border = '2px dashed red';
                element.style.zIndex = '10000';
            }
        };
        
        option.onmouseout = function() {
            this.style.backgroundColor = '';
            // 移除预览高亮
            const element = document.getElementById('ui-element-' + node.id);
            if (element && !element.classList.contains('selected')) {
                element.style.border = '';
                element.style.zIndex = '';
            }
        };
        
        option.onclick = function() {
            // 隐藏菜单
            menu.style.display = 'none';
            // 显示所选节点详情
            showNodeDetails(node.id);
        };
        
        menu.appendChild(option);
    });
    
    // 添加关闭选项
    const closeOption = document.createElement('div');
    closeOption.style.padding = '4px 8px';
    closeOption.style.cursor = 'pointer';
    closeOption.style.textAlign = 'center';
    closeOption.style.borderTop = '1px solid #ccc';
    closeOption.style.marginTop = '5px';
    closeOption.textContent = '关闭';
    closeOption.onclick = function() {
        menu.style.display = 'none';
    };
    menu.appendChild(closeOption);
    
    // 显示菜单以获取其尺寸
    menu.style.display = 'block';
    menu.style.visibility = 'hidden'; // 临时隐藏，但保持占用空间以便测量
    
    // 完全重写菜单定位逻辑，确保在手机视图内完全显示
    const phoneFrame = document.querySelector('.phone-frame');
    const phoneScreen = document.getElementById('phoneScreen');
    const phoneRect = phoneFrame.getBoundingClientRect();
    const screenRect = phoneScreen.getBoundingClientRect();
    
    // 1. 获取菜单尺寸
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    
    // 2. 计算点击位置相对于手机屏幕的坐标
    const screenX = x - screenRect.left;
    const screenY = y - screenRect.top;
    
    console.log(`点击坐标: 屏幕内(${screenX}, ${screenY}), 菜单尺寸: ${menuWidth}x${menuHeight}`);
    
    // 3. 决定菜单显示方向
    let menuX = screenX;
    let menuY = screenY;
    
    // 检查右侧空间
    if (screenX + menuWidth > screenRect.width) {
        // 右侧空间不足，改为向左显示
        menuX = screenX - menuWidth;
        console.log(`右侧空间不足，改为向左显示: ${menuX}`);
    }
    
    // 如果左侧也不够，那么居中显示
    if (menuX < 0) {
        menuX = (screenRect.width - menuWidth) / 2;
        console.log(`左侧空间也不足，居中显示: ${menuX}`);
    }
    
    // 检查底部空间
    if (screenY + menuHeight > screenRect.height) {
        // 底部空间不足，改为向上显示
        menuY = screenY - menuHeight;
        console.log(`底部空间不足，改为向上显示: ${menuY}`);
    }
    
    // 如果顶部也不够，那么尽量靠顶部显示
    if (menuY < 0) {
        menuY = 10; // 留出一点边距
        console.log(`顶部空间也不足，靠顶部显示: ${menuY}`);
    }
    
    // 确保菜单完全在手机屏幕内
    menuX = Math.max(10, Math.min(screenRect.width - menuWidth - 10, menuX));
    menuY = Math.max(10, Math.min(screenRect.height - menuHeight - 10, menuY));
    
    // 应用计算得到的位置
    menu.style.left = `${menuX}px`;
    menu.style.top = `${menuY}px`;
    menu.style.visibility = 'visible'; // 恢复可见性
    
    console.log(`最终菜单位置: (${menuX}, ${menuY})`);
    
    // 点击其他区域关闭菜单
    const closeMenuOnClickOutside = function(e) {
        if (!menu.contains(e.target)) {
            menu.style.display = 'none';
            document.removeEventListener('click', closeMenuOnClickOutside);
        }
    };
    
    setTimeout(() => {
        document.addEventListener('click', closeMenuOnClickOutside);
    }, 10);
}

// 初始化WebSocket连接
function initSocketConnection() {
    try {
        console.log("初始化WebSocket连接...");
        socket = io();
        
        socket.on('connect', function() {
            console.log('WebSocket连接成功');
            showStatusMessage('WebSocket连接成功', 'success');
        });
        
        socket.on('disconnect', function() {
            console.log('WebSocket连接已断开');
            showStatusMessage('WebSocket连接已断开', 'error');
        });
        
        socket.on('ui_data', function(data) {
            console.log('接收到UI数据', data);
            
            // 移除所有示例元素
            const phoneScreen = document.getElementById('phoneScreen');
            phoneScreen.querySelectorAll('.ui-element').forEach(element => {
                if (!element.dataset.nodeId) {
                    element.remove();
                }
            });
            
            // 更新UI
            if (data.nodes) {
                nodeData = data.nodes;
                initPhoneScreen(); // 重新初始化手机屏幕
            }
            
            if (data.tree_html) {
                document.getElementById('uiTree').innerHTML = data.tree_html;
                setupTreeListeners();
            }
            
            if (data.screenshot) {
                deviceScreenshot.src = "data:image/png;base64," + data.screenshot;
                deviceScreenshot.style.display = 'block';
            }
            
            showStatusMessage('已更新UI', 'success');
            
            // 隐藏加载指示器
            loadingIndicator.style.display = 'none';
        });
        
        socket.on('connect_error', function(error) {
            console.error('WebSocket连接错误:', error);
            showStatusMessage('WebSocket连接错误', 'error');
        });
    } catch (error) {
        console.error('初始化WebSocket失败:', error);
        showStatusMessage('初始化WebSocket失败', 'error');
    }
}

// 初始化UI控件
function initUIControls() {
    console.log("初始化UI控件...");
    try {
        // 捕获模式切换
        document.querySelectorAll('input[name="capture-mode"]').forEach(radio => {
            radio.addEventListener('change', function() {
                if (this.value === 'manual') {
                    document.getElementById('manual-capture').style.display = 'block';
                    document.getElementById('auto-capture').style.display = 'none';
                } else {
                    document.getElementById('manual-capture').style.display = 'none';
                    document.getElementById('auto-capture').style.display = 'block';
                }
            });
        });
        
        // 刷新间隔滑块
        if (refreshIntervalSlider) {
            refreshIntervalSlider.addEventListener('input', function() {
                intervalValue.textContent = this.value;
            });
        }
        
        // 刷新设备列表按钮
        const refreshDevicesBtn = document.getElementById('refresh-devices');
        if (refreshDevicesBtn) {
            refreshDevicesBtn.addEventListener('click', function() {
                refreshDeviceList();
            });
        }
        
        // USB连接按钮
        const connectUsbBtn = document.getElementById('connect-usb');
        if (connectUsbBtn) {
            connectUsbBtn.addEventListener('click', function() {
                connectUSB();
            });
        }
        
        // 断开连接按钮
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', function() {
                disconnectDevice();
            });
        }
        
        // 立即捕获按钮
        if (captureNowBtn) {
            captureNowBtn.addEventListener('click', function() {
                captureOnce();
            });
        }
        
        // 保存结果按钮
        if (saveCaptureBtn) {
            saveCaptureBtn.addEventListener('click', function() {
                saveCapture();
            });
        }
        
        // 开始自动捕获按钮
        if (startAutoBtn) {
            startAutoBtn.addEventListener('click', function() {
                startAutoCapture();
            });
        }
        
        // 停止自动捕获按钮
        if (stopAutoBtn) {
            stopAutoBtn.addEventListener('click', function() {
                stopAutoCapture();
            });
        }
        
        console.log("UI控件初始化完成");
    } catch (error) {
        console.error('初始化UI控件失败:', error);
    }
}

// 刷新设备列表
function refreshDeviceList() {
    showStatusMessage('正在刷新设备列表...', 'info');
    console.log("刷新设备列表...");
    
    fetch('/api/devices')
        .then(response => response.json())
        .then(data => {
            console.log("获取设备列表结果:", data);
            deviceList.innerHTML = '<option value="">选择设备...</option>';
            
            if (data.devices && data.devices.length > 0) {
                data.devices.forEach(device => {
                    const option = document.createElement('option');
                    option.value = device.serial;
                    option.textContent = device.serial;
                    deviceList.appendChild(option);
                });
                showStatusMessage('设备列表已更新', 'success');
            } else {
                showStatusMessage('未找到可用设备', 'warning');
            }
        })
        .catch(error => {
            console.error('获取设备列表失败:', error);
            showStatusMessage('获取设备列表失败', 'error');
        });
}

// 通过USB连接设备
function connectUSB() {
    const serial = deviceList.value;
    if (!serial) {
        showStatusMessage('请选择一个设备', 'warning');
        return;
    }
    
    showStatusMessage('正在连接设备...', 'info');
    loadingIndicator.style.display = 'block';
    console.log("连接USB设备:", serial);
    
    fetch('/api/connect/usb', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            serial: serial
        })
    })
    .then(response => response.json())
    .then(data => {
        console.log("连接USB设备结果:", data);
        if (data.success) {
            isConnected = true;
            showStatusMessage('设备连接成功', 'success');
            updateButtonStates();
            updateConnectionStatus(data.status);
        } else {
            showStatusMessage('设备连接失败: ' + (data.status?.error || '未知错误'), 'error');
        }
        loadingIndicator.style.display = 'none';
    })
    .catch(error => {
        console.error('连接设备失败:', error);
        showStatusMessage('连接设备失败', 'error');
        loadingIndicator.style.display = 'none';
    });
}

// 通过WiFi连接设备
function connectWiFi() {
    // 已移除
}

// 断开设备连接
function disconnectDevice() {
    showStatusMessage('正在断开设备连接...', 'info');
    console.log("断开设备连接");
    
    fetch('/api/disconnect', {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        console.log("断开设备连接结果:", data);
        if (data.success) {
            isConnected = false;
            isCapturing = false;
            showStatusMessage('设备已断开连接', 'success');
            updateButtonStates();
            updateConnectionStatus(data.status);
        } else {
            showStatusMessage('断开设备连接失败', 'error');
        }
    })
    .catch(error => {
        console.error('断开设备连接失败:', error);
        showStatusMessage('断开设备连接失败', 'error');
    });
}

// 执行一次UI捕获
function captureOnce() {
    if (!isConnected) {
        showStatusMessage('未连接到设备', 'warning');
        return;
    }
    showStatusMessage('正在唤醒屏幕并捕获UI...', 'info');
    loadingIndicator.style.display = 'block';
    console.log("唤醒屏幕并执行一次UI捕获");

    // 1. 唤醒屏幕
    fetch('/api/device/wakeup', { method: 'POST' })
        .then(response => response.json())
        .then(wakeupData => {
            if (wakeupData.success) {
                console.log("屏幕唤醒成功");
                // 2. 执行捕获
                return fetch('/api/capture', { method: 'POST' });
            } else {
                console.error("屏幕唤醒失败:", wakeupData.error);
                showStatusMessage('屏幕唤醒失败: ' + wakeupData.error, 'error');
                loadingIndicator.style.display = 'none';
                return Promise.reject('Wakeup failed'); // 阻止后续操作
            }
        })
        .then(response => response.json()) // 这是 /api/capture 的 response
        .then(data => {
            console.log("UI捕获结果:", data);
            if (data.success) {
                // 移除所有示例元素
                const phoneScreen = document.getElementById('phoneScreen');
                phoneScreen.querySelectorAll('.ui-element').forEach(element => {
                    if (!element.dataset.nodeId) {
                        element.remove();
                    }
                });
                
                // 更新UI
                if (data.node_data) {
                    nodeData = data.node_data;
                    renderAllElements();
                }
                
                if (data.tree_html) {
                    document.getElementById('uiTree').innerHTML = data.tree_html;
                    setupTreeListeners();
                }
                
                if (data.screenshot_url) {
                    deviceScreenshot.src = data.screenshot_url;
                    deviceScreenshot.style.display = 'block';
                }
                
                saveCaptureBtn.disabled = false;
                showStatusMessage('UI捕获成功', 'success');
            } else {
                console.log('UIfffff捕获失败:', data);
                showStatusMessage('UI捕获失败: ' + (data.error || '未知错误'), 'error');
            }
            loadingIndicator.style.display = 'none';
        })
        .catch(error => {
            console.error('唤醒屏幕或UI捕获失败:', error);
            if (error !== 'Wakeup failed') { // 如果不是唤醒失败，则显示捕获失败
                showStatusMessage('UI捕获失败', 'error');
            }
            loadingIndicator.style.display = 'none';
        });
}

// 保存捕获结果
function saveCapture() {
    showStatusMessage('正在保存结果...', 'info');
    console.log("保存捕获结果");
    
    fetch('/api/save', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
    })
    .then(response => response.json())
    .then(data => {
        console.log("保存结果:", data);
        if (data.success) {
            showStatusMessage('结果已保存', 'success');
        } else {
            showStatusMessage('保存结果失败', 'error');
        }
    })
    .catch(error => {
        console.error('保存结果失败:', error);
        showStatusMessage('保存结果失败', 'error');
    });
}

// 开始自动捕获
function startAutoCapture() {
    if (!isConnected) {
        showStatusMessage('未连接到设备', 'warning');
        return;
    }
    
    const interval = parseFloat(refreshIntervalSlider.value);
    
    showStatusMessage(`正在启动自动捕获 (${interval}秒)...`, 'info');
    console.log(`开始自动捕获, 间隔: ${interval}秒`);
    
    fetch('/api/auto_capture/start', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            interval: interval
        })
    })
    .then(response => response.json())
    .then(data => {
        console.log("开始自动捕获结果:", data);
        if (data.success) {
            isCapturing = true;
            showStatusMessage('自动捕获已启动', 'success');
            updateButtonStates();
        } else {
            showStatusMessage('启动自动捕获失败', 'error');
        }
    })
    .catch(error => {
        console.error('启动自动捕获失败:', error);
        showStatusMessage('启动自动捕获失败', 'error');
    });
}

// 停止自动捕获
function stopAutoCapture() {
    showStatusMessage('正在停止自动捕获...', 'info');
    console.log("停止自动捕获");
    
    fetch('/api/auto_capture/stop', {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        console.log("停止自动捕获结果:", data);
        if (data.success) {
            isCapturing = false;
            showStatusMessage('自动捕获已停止', 'success');
            updateButtonStates();
        } else {
            showStatusMessage('停止自动捕获失败', 'error');
        }
    })
    .catch(error => {
        console.error('停止自动捕获失败:', error);
        showStatusMessage('停止自动捕获失败', 'error');
    });
}

// 获取当前状态
function updateStatus() {
    console.log("获取当前状态");
    fetch('/api/status')
        .then(response => response.json())
        .then(data => {
            console.log("当前状态:", data);
            if (data.device) {
                isConnected = data.device.connected;
                updateConnectionStatus(data.device);
            }
            
            if (data.capture) {
                isCapturing = data.capture.auto_enabled;
            }
            
            updateButtonStates();
        })
        .catch(error => {
            console.error('获取状态失败:', error);
        });
}

// 更新连接状态显示
function updateConnectionStatus(status) {
    if (status.connected) {
        connectionStatus.textContent = status.connection_type === 'usb' 
            ? `已连接 (USB: ${status.device_serial})` 
            : `已连接 (WiFi: ${status.device_ip})`;
        statusIndicator.className = 'status-indicator status-connected';
        disconnectBtn.style.display = 'inline-block';
    } else if (status.status === 'error') {
        connectionStatus.textContent = `连接错误: ${status.error || '未知错误'}`;
        statusIndicator.className = 'status-indicator status-error';
        disconnectBtn.style.display = 'inline-block';
    } else {
        connectionStatus.textContent = '未连接';
        statusIndicator.className = 'status-indicator status-disconnected';
        disconnectBtn.style.display = 'none';
    }
}

// 更新按钮状态
function updateButtonStates() {
    captureNowBtn.disabled = !isConnected;
    startAutoBtn.disabled = !isConnected || isCapturing;
    stopAutoBtn.style.display = isCapturing ? 'inline-block' : 'none';
    saveCaptureBtn.disabled = !nodeData || nodeData.length === 0;
}

// 显示状态消息
function showStatusMessage(message, type) {
    const statusMsg = document.getElementById('status-message');
    statusMsg.textContent = message;
    
    // 设置颜色
    if (type === 'error') {
        statusMsg.style.backgroundColor = 'rgba(244, 67, 54, 0.8)';
    } else if (type === 'success') {
        statusMsg.style.backgroundColor = 'rgba(76, 175, 80, 0.8)';
    } else if (type === 'warning') {
        statusMsg.style.backgroundColor = 'rgba(255, 152, 0, 0.8)';
    } else {
        statusMsg.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    }
    
    // 显示消息
    statusMsg.style.display = 'block';
    
    // 3秒后隐藏
    setTimeout(() => {
        statusMsg.style.display = 'none';
    }, 3000);
}

// 切换截图显示
function toggleScreenshot() {
    const show = document.getElementById('showScreenshot').checked;
    deviceScreenshot.style.display = show ? 'block' : 'none';
}

// 切换元素框显示
function toggleElements() {
    const show = document.getElementById('showElements').checked;
    document.getElementById('contentWrapper').style.display = show ? 'block' : 'none';
}

// 辅助函数：查找树节点元素
function findTreeNodeById(nodeId) {
    console.log(`尝试查找树节点: ${nodeId}`);
    
    // 处理空节点ID
    if (!nodeId) {
        console.error("查找节点时提供了空的节点ID");
        return null;
    }
    
    // 将节点ID转换为字符串
    nodeId = nodeId.toString();
    
    // 尝试查找可能的节点格式
    // 1. 直接查找 node-ID
    let node = document.getElementById('node-' + nodeId);
    if (node) {
        console.log(`通过node-${nodeId}直接找到节点`);
        return node;
    }
    
    // 2. 尝试查找不带前缀的ID
    node = document.getElementById(nodeId);
    if (node) {
        console.log(`通过${nodeId}直接找到节点`);
        return node;
    }
    
    // 3. 尝试查找更多节点样式 (summary或span元素)
    const nodeDataObj = nodeData.find(n => n.id === nodeId);
    if (!nodeDataObj) {
        console.warn(`在节点数据中找不到ID为${nodeId}的节点`);
        return null;
    }
    
    // 4. 尝试通过属性哈希匹配查找
    const bounds = nodeDataObj.attributes.bounds || "";
    const className = nodeDataObj.attributes.class || "";
    const resourceId = nodeDataObj.attributes['resource-id'] || "";
    
    // 生成类似于后端的哈希ID
    const possibleHashIds = [];
    
    // 尝试各种组合的哈希
    if (resourceId && bounds && className) {
        possibleHashIds.push(`node-${Math.abs(hashCode(resourceId + bounds + className))}`, 
                            `node-${Math.abs(hashCode(bounds + className + resourceId))}`);
    }
    if (resourceId && bounds) {
        possibleHashIds.push(`node-${Math.abs(hashCode(resourceId + bounds))}`, 
                            `node-${Math.abs(hashCode(bounds + resourceId))}`);
    }
    if (resourceId && className) {
        possibleHashIds.push(`node-${Math.abs(hashCode(resourceId + className))}`, 
                            `node-${Math.abs(hashCode(className + resourceId))}`);
    }
    if (bounds && className) {
        possibleHashIds.push(`node-${Math.abs(hashCode(bounds + className))}`, 
                            `node-${Math.abs(hashCode(className + bounds))}`);
    }
    if (resourceId) {
        possibleHashIds.push(`node-${Math.abs(hashCode(resourceId))}`);
    }
    if (bounds) {
        possibleHashIds.push(`node-${Math.abs(hashCode(bounds))}`);
    }
    if (className) {
        possibleHashIds.push(`node-${Math.abs(hashCode(className))}`);
    }
    
    // 测试所有可能的哈希ID
    for (const hashId of possibleHashIds) {
        node = document.getElementById(hashId);
        if (node) {
            console.log(`通过哈希ID ${hashId} 找到节点`);
            return node;
        }
    }
    
    // 5. 最后尝试遍历所有树节点，根据内容匹配
    const allNodes = document.querySelectorAll('.ui-tree summary, .ui-tree span');
    console.log(`搜索树中${allNodes.length}个节点以匹配节点${nodeId}`);
    
    const text = nodeDataObj.attributes.text || "";
    const contentDesc = nodeDataObj.attributes['content-desc'] || "";
    
    for (let el of allNodes) {
        const nodeText = el.textContent.trim();
        
        // 匹配特定属性
        if (resourceId && nodeText.includes(resourceId)) {
            console.log(`通过resource-id内容匹配找到节点`);
            return el;
        }
        
        if (text && nodeText.includes(text)) {
            console.log(`通过text内容匹配找到节点`);
            return el;
        }
        
        if (contentDesc && nodeText.includes(contentDesc)) {
            console.log(`通过content-desc内容匹配找到节点`);
            return el;
        }
        
        if (bounds && nodeText.includes(bounds)) {
            console.log(`通过bounds内容匹配找到节点`);
            return el;
        }
        
        // 匹配简短类名
        if (className) {
            const shortClassName = className.split('.').pop();
            if (nodeText.includes(shortClassName)) {
                console.log(`通过class内容匹配找到节点`);
                return el;
            }
        }
    }
    
    console.warn(`无法在树中找到节点: ${nodeId}`);
    return null;
}

// 简单的哈希函数，用于模拟后端的ID生成逻辑
function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash >>> 0; // 转换为无符号整数
}