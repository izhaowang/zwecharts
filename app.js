// 定义常量
const NUM_CHANNELS = 12; // 每个图的通道数
const POINTS_PER_CHANNEL = 2600; // 每个通道的点数
const REFRESH_INTERVAL_MS = 100; // 刷新频率 (100ms = 10Hz)
const VERTICAL_OFFSET_PER_CHANNEL = 0.8; // 每个通道的垂直偏移量

// ========== 通道显隐状态（true=显示，false=隐藏）==========
const channelVisibleHF = Array(NUM_CHANNELS).fill(false).map((_, i) => i < 3);
const channelVisibleLF = Array(NUM_CHANNELS).fill(false).map((_, i) => i < 3);
// 测量开关（true = 允许绘制测量线，false = 禁止）
let isMeasurementEnabled = false;
// ECharts 实例
let chartHF = null;
let chartLF = null;

// 数据缓存：用于查找与测量线的交点（包含 x,y 对）
const dataBuffersHF = Array(NUM_CHANNELS).fill(0).map(() => []);
const dataBuffersLF = Array(NUM_CHANNELS).fill(0).map(() => []);

// 测量线（每个图最多保留两个），元素形如 { x: number }
const measurementLinesHF = [];
const measurementLinesLF = [];

// 存储当前绘制在 chart 上的 measurement graphic id 列表
const measurementGraphicIdsHF = [];
const measurementGraphicIdsLF = [];
// 全局计数器用于生成唯一的 graphic id，避免 id 冲突
let measurementGraphicCounter = 0;

// 全局 X 轴计数器，用于模拟时间或数据点索引
let globalX = 0;

// 存储每个通道的当前状态（用于生成更平滑且不规则的数据）
const channelStatesHF = Array(NUM_CHANNELS).fill(null);
const channelStatesLF = Array(NUM_CHANNELS).fill(null);

// 每通道的额外垂直偏移（可由右侧箭头控件拖动控制）
const channelAdjustHF = Array(NUM_CHANNELS).fill(0);
const channelAdjustLF = Array(NUM_CHANNELS).fill(0);

// 每通道颜色和标签（可自定义，页面运行时可通过 window 修改）
const channelColorsHF = Array.from({ length: NUM_CHANNELS }, (_, i) => `hsl(${i * (360 / NUM_CHANNELS)}, 70%, 45%)`);
const channelColorsLF = Array.from({ length: NUM_CHANNELS }, (_, i) => `hsl(${180 + i * (360 / NUM_CHANNELS)}, 70%, 45%)`);
const channelLabelsHF = Array.from({ length: NUM_CHANNELS }, (_, i) => `HF${i + 1}`);
const channelLabelsLF = Array.from({ length: NUM_CHANNELS }, (_, i) => `LF${i + 1}`);

// 暴露以便外部自定义
window.channelColors = { HF: channelColorsHF, LF: channelColorsLF };
window.channelLabels = { HF: channelLabelsHF, LF: channelLabelsLF };

// --- 新增：量程和通道管理 ---
const channelSelect = document.getElementById('channel-select');
const rangeSelect = document.getElementById('range-select');

// 存储每个通道的量程设置 (channelId -> rangeString)
const channelRanges = new Map();
// 定义量程对应的Y轴总跨度 (rangeString -> { span: number in Volts })
// 假设我们的数据单位是V，所以10mv = 0.01V
const rangeToYAxisMap = new Map([
    ['10mv', { span: 0.01 }],
    ['50mv', { span: 0.05 }],
    ['100mv', { span: 0.1 }],
    ['500mv', { span: 0.5 }],
    ['1V', { span: 1.0 }],
    ['5V', { span: 5.0 }],
    ['10V', { span: 10.0 }]
]);

let currentSelectedChannelId = ''; // 当前在CH下拉框中选中的通道ID

// --- 调整：基础垂直偏移量，使所有通道围绕Y轴0点对称分布 ---
const BASE_VERTICAL_OFFSET = -(NUM_CHANNELS - 1) / 2 * VERTICAL_OFFSET_PER_CHANNEL;

/**
 * 获取通道的垂直中心线
 * @param {number} channelIndex 通道索引 (0-11)
 * @returns {number} 垂直偏移量
 */
// 旧版 getVerticalOffset 已被带 chartType 的版本替代

/**
 * 返回通道中心线，包含可调整的偏移量（由右侧箭头控制）
 * @param {number} channelIndex
 * @param {'HF'|'LF'} chartType
 */
function getVerticalOffset(channelIndex, chartType = 'HF') {
    const base = BASE_VERTICAL_OFFSET + channelIndex * VERTICAL_OFFSET_PER_CHANNEL;
    const adjust = chartType === 'HF' ? channelAdjustHF[channelIndex] || 0 : channelAdjustLF[channelIndex] || 0;
    return base + adjust;
}

/**
 * 生成单个新的数据点，模拟平滑且不规则的波动
 * @param {number} x 当前X轴值 (代表时间)
 * @param {number} channelIndex 通道索引
 * @param {number} baseFrequency 基础频率（影响底层波动速度）
 * @param {number} amplitudeScale 基础振幅（影响波动范围）
 * @param {object} channelStates 当前图表的通道状态数组
 * @returns {Array<number>} [x, y] 格式的数据点
 */
function generateNewPoint(x, channelIndex, baseFrequency, amplitudeScale, channelStates) {
    const chartType = channelStates === channelStatesHF ? 'HF' : 'LF';
    const verticalOffset = getVerticalOffset(channelIndex, chartType);

    // 每次生成都使用新的随机参数
    const frequency = baseFrequency * (0.8 + Math.random() * 0.4); // 频率在80%-120%之间变化
    const amplitude = amplitudeScale * (0.7 + Math.random() * 0.6); // 振幅在70%-130%之间变化

    // 针对高频图的通道3-5（索引2-4）进行特殊调整
    const isHighImpactHFChannel = (channelStates === channelStatesHF && channelIndex >= 2 && channelIndex <= 4);
    let finalAmplitude = amplitude;
    if (isHighImpactHFChannel) {
        finalAmplitude *= 2.0; // 增加振幅
    }

    // 生成新的随机相位
    const phase = Math.random() * Math.PI * 2;

    // 基础正弦波
    let y = Math.sin(phase + x * frequency) * finalAmplitude;

    // 添加谐波
    y += Math.sin(phase * 1.3 + x * frequency * 2) * finalAmplitude * 0.3;

    // 添加随机噪声
    y += (Math.random() - 0.5) * finalAmplitude * 0.2;

    // 偶尔添加尖峰
    if (Math.random() < 0.05) { // 5%的概率出现尖峰
        y += (Math.random() > 0.5 ? 1 : -1) * finalAmplitude * 0.8;
    }

    // 限制范围
    const maxValue = finalAmplitude * 1.5;
    if (y > maxValue) y = maxValue;
    if (y < -maxValue) y = -maxValue;

    return [x, y + verticalOffset];
}

/**
 * 生成全新的系列数据（每次调用都生成全新波形）
 * @param {number} channelIndex 通道索引
 * @param {number} baseFrequency 基础频率
 * @param {number} amplitudeScale 基础振幅
 * @param {object} channelStates 当前图表的通道状态数组
 * @returns {Array<Array<number>>} 包含 POINTS_PER_CHANNEL 个数据点的数组
 */
function generateNewSeriesData(channelIndex, baseFrequency, amplitudeScale, channelStates) {
    const data = [];
    const chartType = channelStates === channelStatesHF ? 'HF' : 'LF';
    const verticalOffset = getVerticalOffset(channelIndex, chartType);

    // 为每次生成创建新的随机种子
    const frequency = baseFrequency * (0.8 + Math.random() * 0.4);
    const amplitude = amplitudeScale * (0.7 + Math.random() * 0.6);

    // 针对高频图的通道3-5（索引2-4）进行特殊调整
    const isHighImpactHFChannel = (channelStates === channelStatesHF && channelIndex >= 2 && channelIndex <= 4);
    let finalAmplitude = amplitude;
    if (isHighImpactHFChannel) {
        finalAmplitude *= 2.0;
    }

    // 生成全新的随机相位
    const phase = Math.random() * Math.PI * 2;

    for (let i = 0; i < POINTS_PER_CHANNEL; i++) {
        // 基础正弦波
        let y = Math.sin(phase + i * frequency) * finalAmplitude;

        // 添加谐波
        y += Math.sin(phase * 1.3 + i * frequency * 2) * finalAmplitude * 0.3;
        y += Math.sin(phase * 1.7 + i * frequency * 3) * finalAmplitude * 0.15;

        // 添加随机噪声
        y += (Math.random() - 0.5) * finalAmplitude * 0.3;

        // 偶尔添加尖峰（高频特殊通道概率更高）
        let spikeProb = 0.05;
        if (isHighImpactHFChannel) spikeProb = 0.1;
        if (Math.random() < spikeProb) {
            y += (Math.random() > 0.5 ? 1 : -1) * finalAmplitude * 0.8;
        }

        // 限制范围
        const maxValue = finalAmplitude * 1.5;
        if (y > maxValue) y = maxValue;
        if (y < -maxValue) y = -maxValue;

        data.push([i, y + verticalOffset]);
    }

    return data;
}
/**
 * 生成初始的系列数据 (与 generateNewPoint 逻辑保持一致)
 * @param {number} channelIndex 通道索引
 * @param {number} baseFrequency 基础频率
 * @param {number} amplitudeScale 基础振幅
 * @param {object} channelStates 当前图表的通道状态数组
 * @returns {Array<Array<number>>} 包含 POINTS_PER_CHANNEL 个数据点的数组
 */
// 修改初始数据生成函数，确保数据方向一致
function generateInitialSeriesData(channelIndex, baseFrequency, amplitudeScale, channelStates) {
    const data = [];
    const state = channelStates[channelIndex];
    // 重置初始状态
    state.lastValue = 0;
    state.phase = Math.random() * Math.PI * 2;
    state.randomOffset = (Math.random() - 0.5) * 0.2;

    for (let i = 0; i < POINTS_PER_CHANNEL; i++) {
        const chartType = channelStates === channelStatesHF ? 'HF' : 'LF';
        const verticalOffset = getVerticalOffset(channelIndex, chartType);
        let currentAmplitudeScale = amplitudeScale * (1 + channelIndex * 0.05);

        const isHighImpactHFChannel = (channelStates === channelStatesHF && channelIndex >= 2 && channelIndex <= 4);

        if (isHighImpactHFChannel) {
            currentAmplitudeScale *= 1.8;
        }

        let step = (Math.random() - 0.5) * 0.05;
        if (isHighImpactHFChannel) {
            step *= 2.5;
        }

        let pullFactor = 0.05;
        if (isHighImpactHFChannel) {
            pullFactor *= 0.4;
        }
        step -= (state.lastValue) * pullFactor;

        state.phase += baseFrequency * (1 + channelIndex * 0.02);
        const oscillation = Math.sin(state.phase) * (currentAmplitudeScale * 0.7);

        state.randomOffset += (Math.random() - 0.5) * 0.01;
        if (state.randomOffset > 0.2) state.randomOffset = 0.2;
        if (state.randomOffset < -0.2) state.randomOffset = -0.2;

        let rawValue = oscillation + state.randomOffset + step;

        let rangeLimit = currentAmplitudeScale * 1.5;
        if (isHighImpactHFChannel) {
            rangeLimit *= 1.5;
        }
        if (rawValue > rangeLimit) rawValue = rangeLimit;
        if (rawValue < -rangeLimit) rawValue = -rangeLimit;

        state.lastValue = rawValue;
        // 这里保持原来的顺序，左侧索引小，右侧索引大
        data.push([i, rawValue + verticalOffset]);
    }
    return data;
}

/**
 * 根据当前选中的通道和量程，更新对应图表的Y轴范围及单位
 * - Y轴范围固定为 ±量程
 * - 轴标签和轴名称自动匹配单位（V 或 mV）
 */
function applyRangeToChart() {
    if (!currentSelectedChannelId) return;

    const [chartType, channelNumStr] = currentSelectedChannelId.split('_');
    const channelIndex = parseInt(channelNumStr) - 1;

    const selectedRangeString = channelRanges.get(currentSelectedChannelId);
    // 解析量程字符串，例如 "5V", "100mv"
    const match = selectedRangeString.match(/^(\d+(?:\.\d+)?)(mv|V)$/i);
    if (!match) {
        console.warn(`无法解析量程字符串: ${selectedRangeString}`);
        return;
    }
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    // 转换为伏特（V）
    let rangeValue = value;
    if (unit === 'mv') {
        rangeValue = value / 1000;
    }

    // Y轴范围固定为 ±量程
    const yMin = -rangeValue;
    const yMax = rangeValue;

    // 根据单位设置轴标签格式化和轴名称
    let axisLabelFormatter, axisName;
    if (unit === 'v') {
        axisLabelFormatter = function (val) {
            return val.toFixed(2);
        };
        axisName = 'V';
    } else { // mv
        axisLabelFormatter = function (val) {
            return (val * 1000).toFixed(1);
        };
        axisName = 'mV';
    }

    const chartToUpdate = chartType === 'HF' ? chartHF : chartLF;
    if (chartToUpdate) {
        chartToUpdate.setOption({
            yAxis: {
                min: yMin,
                max: yMax,
                axisLabel: {
                    formatter: axisLabelFormatter
                },
                name: axisName
            },
            // 重置 dataZoom 的 Y 轴状态，确保量程下拉框的优先级
            dataZoom: [{
                yAxisIndex: 0,
                start: 0,
                end: 100
            }]
        });

        // 确保所有通道的中心线在当前 y 轴范围内，若不在则自动裁剪箭头偏移
        const baseClamp = (idx) => BASE_VERTICAL_OFFSET + idx * VERTICAL_OFFSET_PER_CHANNEL;
        const arrowsArray = chartType === 'HF' ? channelAdjustHF : channelAdjustLF;
        for (let i = 0; i < NUM_CHANNELS; i++) {
            const base = baseClamp(i);
            const curAdjust = arrowsArray[i] || 0;
            const curCenter = base + curAdjust;
            let newAdjust = curAdjust;
            if (curCenter < yMin) newAdjust = yMin - base + 0.001;
            if (curCenter > yMax) newAdjust = yMax - base - 0.001;
            if (Math.abs(newAdjust - curAdjust) > 1e-9) {
                applyChannelAdjust(i, chartType, newAdjust);
            }
        }
    }
}

/**
 * 在给定数据缓冲中，按 x 值线性插值得到每个 series 与垂直线的交点
 * @param {Array<Array<Array<number>>>} buffers 每个通道的数据缓冲，buffers[channelIndex] = [[x,y],...]
 * @param {number} xValue 垂直线的 x 值
 * @returns {Array<Array<number>>} 交点数组 [[x,y], ...]
 */
function computeIntersections(buffers, xValue) {
    const results = [];
    for (let i = 0; i < buffers.length; i++) {
        const buf = buffers[i];
        if (!buf || buf.length === 0) continue;
        // 找到第一个使得 buf[j][0] <= xValue <= buf[j+1][0]
        let found = false;
        for (let j = 0; j < buf.length - 1; j++) {
            const x1 = buf[j][0];
            const y1 = buf[j][1];
            const x2 = buf[j + 1][0];
            const y2 = buf[j + 1][1];
            if ((x1 <= xValue && xValue <= x2) || (x2 <= xValue && xValue <= x1)) {
                // 线性插值
                let y;
                if (x2 === x1) {
                    y = y1;
                } else {
                    y = y1 + (y2 - y1) * ((xValue - x1) / (x2 - x1));
                }
                results.push([xValue, y]);
                found = true;
                break;
            }
        }
        // 如果没找到，但恰好等于最后一点的 x
        if (!found) {
            const last = buf[buf.length - 1];
            const first = buf[0];
            if (Math.abs(last[0] - xValue) < 1e-9) {
                results.push([xValue, last[1]]);
            } else if (Math.abs(first[0] - xValue) < 1e-9) {
                results.push([xValue, first[1]]);
            } else {
                // 无精确匹配且不在范围内，跳过该通道
            }
        }
    }
    return results;
}
function deleteMeasurementLinesOnChart(chart, lines) {
    // 清除标线
    try {
        // 清空图表上的 graphic（兜底）并清理记录的 id 列表
        const options = chart.getOption();
        options.graphic = [];
        chart.setOption(options, true);
        if (chart === chartHF) measurementGraphicIdsHF.length = 0;
        else if (chart === chartLF) measurementGraphicIdsLF.length = 0;
    } catch (err) {
        try {
            chart.setOption({ graphic: [] });
        } catch (e) {
            console.warn('deleteMeasurementLinesOnChart failed', e);
        }
    }
}

/**
 * 更新图表上的测量线显示（使用 series id '__measure_lines__'）
 * @param {echarts.ECharts} chart
 * @param {Array<{x:number}>} lines
 */
function updateMeasurementLinesOnChart(chart, lines) {
    if (!chart) return;
    // 使用 graphic 绘制测量线，并通过 $action: 'remove' 删除之前的测量线 graphic（按 id）
    const opt = chart.getOption();
    const yAxis = opt.yAxis && opt.yAxis[0] ? opt.yAxis[0] : {};
    const yMin = (yAxis.min !== undefined) ? yAxis.min : -1e6;
    const yMax = (yAxis.max !== undefined) ? yAxis.max : 1e6;

    // 判定 chart 类型以选择对应的 id 存储
    let chartType = null;
    if (chart === chartHF) chartType = 'HF';
    else if (chart === chartLF) chartType = 'LF';

    const prevIds = chartType === 'HF' ? measurementGraphicIdsHF : (chartType === 'LF' ? measurementGraphicIdsLF : []);
    const removeActions = [];
    for (let id of prevIds) {
        removeActions.push({ $action: 'remove', id: id });
    }

    const newGraphics = [];
    const newIds = [];
    try {
        // 使用固定的 x 值（处于显示范围内）进行 y->像素转换，避免依赖全局滚动索引
        const anchorX = 0;
        const topPixel = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [anchorX, yMax])[1];
        const bottomPixel = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [anchorX, yMin])[1];
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            const px = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [l.x, yMin])[0];
            // 生成唯一 id，避免与之前的 id 冲突导致删除/添加顺序问题
            const id = `measure_line_${chartType || 'UNK'}_${measurementGraphicCounter++}_${i}`;
            newIds.push(id);
            newGraphics.push({
                id: id,
                type: 'line',
                shape: { x1: px, y1: topPixel, x2: px, y2: bottomPixel },
                style: { stroke: '#ff5722', lineWidth: 1, lineDash: [6, 4], opacity: 0.9 },
                silent: true,
                z: 1000
            });
        }
    } catch (err) {
        // convertToPixel 可能在图表尚未完成渲染时失败，降级为不绘制
    }

    // 先删除旧的，再添加新的 graphic
    const combined = removeActions.concat(newGraphics);
    if (combined.length > 0) {
        try {
            chart.setOption({ graphic: combined });
        } catch (err) {
            // 兜底：普通更新
            chart.setOption({ graphic: combined });
        }
    }

    // 更新记录的 id 列表
    if (chartType === 'HF') {
        measurementGraphicIdsHF.length = 0;
        Array.prototype.push.apply(measurementGraphicIdsHF, newIds);
    } else if (chartType === 'LF') {
        measurementGraphicIdsLF.length = 0;
        Array.prototype.push.apply(measurementGraphicIdsLF, newIds);
    }
}

// 存放箭头 DOM 引用
const arrowElemsHF = [];
const arrowElemsLF = [];

/**
 * 将某通道的调整应用到数据缓冲和图表上（平移所有 y 值）
 * @param {number} channelIndex
 * @param {'HF'|'LF'} chartType
 * @param {number} newAdjust
 */
function applyChannelAdjust(channelIndex, chartType, newAdjust) {
    const base = BASE_VERTICAL_OFFSET + channelIndex * VERTICAL_OFFSET_PER_CHANNEL;
    const prevAdjust = chartType === 'HF' ? channelAdjustHF[channelIndex] : channelAdjustLF[channelIndex];
    const delta = newAdjust - (prevAdjust || 0);
    if (Math.abs(delta) < 1e-9) return;

    // 更新存储
    if (chartType === 'HF') channelAdjustHF[channelIndex] = newAdjust;
    else channelAdjustLF[channelIndex] = newAdjust;

    // 选择对应的 chart 和 buffer
    const chart = chartType === 'HF' ? chartHF : chartLF;
    const buffers = chartType === 'HF' ? dataBuffersHF : dataBuffersLF;

    // 平移缓冲并更新 series 数据
    const buf = buffers[channelIndex];
    if (buf && buf.length) {
        const newData = buf.map(p => [p[0], p[1] + delta]);
        buffers[channelIndex] = newData.slice();
        // 更新图表对应 series
        try {
            // 使用 series name 来定位并更新特定 series，避免因索引或重排导致更新错位
            const seriesName = (chartType === 'HF') ? `HF Channel ${channelIndex + 1}` : `LF Channel ${channelIndex + 1}`;
            chart.setOption({ series: [{ name: seriesName, data: newData }] });
        } catch (err) {
            console.warn('applyChannelAdjust setOption failed', err);
            try {
                // 兜底：按 index 更新
                chart.setOption({ series: [{ seriesIndex: channelIndex, data: newData }] });
            } catch (e) {
                console.error('applyChannelAdjust fallback failed', e);
            }
        }
    }

    // 更新箭头位置
    updateArrowPositions(chart, chartType);
}

/**
 * 更新箭头 DOM 的位置（根据当前通道中心 y 值映射到像素）
 */
function updateArrowPositions(chart, chartType) {
    if (!chart) return;
    const container = chart.getDom();
    const arrows = chartType === 'HF' ? arrowElemsHF : arrowElemsLF;
    for (let i = 0; i < arrows.length; i++) {
        const el = arrows[i];
        if (!el) continue;
        const centerY = getVerticalOffset(i, chartType);
        try {
            const pixel = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [0, centerY]);
            const top = pixel[1] - el.offsetHeight / 2;
            // 计算绘图区像素范围，确保箭头只显示在绘图区内，避免覆盖图例
            const opt = chart.getOption();
            const yAxis = opt.yAxis && opt.yAxis[0] ? opt.yAxis[0] : {};
            const yMin = (yAxis.min !== undefined) ? yAxis.min : -1e6;
            const yMax = (yAxis.max !== undefined) ? yAxis.max : 1e6;
            const topPixel = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [0, yMax])[1];
            const bottomPixel = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [0, yMin])[1];
            // 额外计算 grid.top（可能为百分比或数字），确保箭头不覆盖图例/标题区域
            let gridTopPx = 0;
            try {
                const gridTop = (opt && opt.grid && opt.grid[0] && opt.grid[0].top !== undefined) ? opt.grid[0].top : 80;
                const rect = container.getBoundingClientRect();
                if (typeof gridTop === 'string' && gridTop.indexOf('%') !== -1) {
                    gridTopPx = parseFloat(gridTop) / 100 * rect.height;
                } else {
                    gridTopPx = Number(gridTop);
                }
            } catch (e) {
                gridTopPx = topPixel; // fallback
            }
            // 若图例已被隐藏，则保持隐藏；否则根据绘图区位置决定显示或隐藏
            if (el.dataset && el.dataset.legendVisible === 'false') {
                el.style.display = 'none';
            } else if (top < Math.min(topPixel - 4, gridTopPx + 2) || top > bottomPixel + 4) {
                el.style.display = 'none';
            } else {
                el.style.display = '';
                el.style.top = `${top}px`;
            }
        } catch (err) {
            el.style.display = 'none';
        }
    }
}

/**
 * 箭头控件：左侧三角形（伪元素） + 右侧矩形（div本身）
 * 完全采用用户提供的 border 画三角方案，无任何多余嵌套
 */
function createArrowControls(chart, chartType) {
    if (!chart) return;
    const container = chart.getDom();
    container.style.position = 'relative';

    const arrowsArray = chartType === 'HF' ? arrowElemsHF : arrowElemsLF;
    const colors = chartType === 'HF' ? channelColorsHF : channelColorsLF;
    const labels = chartType === 'HF' ? channelLabelsHF : channelLabelsLF;

    // 统一箭头尺寸：矩形宽80px，高24px；三角形宽度12px（可自定义）
    const RECT_WIDTH = 58;
    const RECT_HEIGHT = 24;
    const TRIANGLE_WIDTH = 12;   // 三角形底边宽度，同时也是 left 负偏移量

    for (let i = 0; i < NUM_CHANNELS; i++) {
        // ----- 主容器：右侧矩形（背景色、文字）-----
        const el = document.createElement('div');
        el.className = 'channel-arrow';
        el.style.position = 'absolute';
        el.style.right = '6px';                // 距离右侧边缘
        el.style.width = RECT_WIDTH + 'px';
        el.style.height = RECT_HEIGHT + 'px';
        el.style.lineHeight = RECT_HEIGHT + 'px';
        el.style.textAlign = 'center';         // 文字水平居中
        el.style.background = colors[i];       // 矩形背景色
        el.style.color = '#fff';
        el.style.fontSize = '12px';
        el.style.fontWeight = '500';
        el.style.whiteSpace = 'nowrap';
        el.style.overflow = 'visible';
        // el.style.position = 'relative';   // 必须
        el.style.textOverflow = 'ellipsis';
        // el.style.pointerEvents = 'none';   // 箭头完全不响应鼠标，点击完全穿透到图表
        el.style.cursor = 'pointer';
        el.style.userSelect = 'none';
        el.style.zIndex = '1999';
        el.style.display = 'none';             // 初始隐藏，定位后显示


        // ----- 直接设置文字内容（居中显示）-----
        el.textContent = labels[i];

        // ----- 存储 data 属性 -----
        el.dataset.channelIndex = String(i);
        el.dataset.legendVisible = 'true';

        container.appendChild(el);
        arrowsArray.push(el);

        // ----- 为每个箭头生成唯一的 class，用于定义伪元素三角形 -----
        const arrowClass = `channel-arrow-${chartType}-${i}`;
        el.classList.add(arrowClass);

        // ----- 动态插入 CSS 规则：完全按照您的 border 画三角方法 -----
        const style = document.createElement('style');
        style.textContent = `
            .${arrowClass} {
                position: relative;  /* 为伪元素提供定位基准 */
            }
            .${arrowClass}::before {
                content: '';
                position: absolute;
                left: -${TRIANGLE_WIDTH}px;     /* 负值将三角形定位到矩形左侧外部 */
                top: 0;
                width: 0;
                height: 0;
                border-style: solid;
                /* border-width: 上 右 下 左 */
                border-width: ${RECT_HEIGHT/2}px ${TRIANGLE_WIDTH}px ${RECT_HEIGHT/2}px 0;
                border-color: transparent ${colors[i]} transparent transparent;
                pointer-events: none;  /* 确保点击穿透，拖拽时鼠标可点击矩形区域 */
            }
        `;
        document.head.appendChild(style);

        // --- 拖拽逻辑（完全保留，无需任何修改）---
        let dragging = false;
        let moved = false;
        const onMouseDown = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            el.style.cursor = 'ns-resize';
            dragging = true;
            moved = false;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };
        const onMouseMove = (ev) => {
            if (!dragging) return;
            moved = true;
            const rect = container.getBoundingClientRect();
            const offsetX = ev.clientX - rect.left;
            const offsetY = ev.clientY - rect.top;
            let dataPos;
            try {
                dataPos = chart.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [offsetX, offsetY]);
            } catch (err) {
                return;
            }
            const newCenter = dataPos[1];
            const opt = chart.getOption();
            let yMin = opt.yAxis?.[0]?.min ?? -Infinity;
            let yMax = opt.yAxis?.[0]?.max ?? Infinity;
            const clamped = Math.max(yMin, Math.min(yMax, newCenter));
            const base = BASE_VERTICAL_OFFSET + i * VERTICAL_OFFSET_PER_CHANNEL;
            const newAdjust = clamped - base;
            applyChannelAdjust(i, chartType, newAdjust);
        };
        const onMouseUp = (ev) => {
            dragging = false;
            el.style.cursor = 'pointer';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (!moved) {
                const id = `${chartType}_${i + 1}`;
                currentSelectedChannelId = id;
                channelSelect.value = id;
                const presetRange = channelRanges.get(id) || '5V';
                rangeSelect.value = presetRange;
                applyRangeToChart();
            }
        };

        el.addEventListener('mousedown', onMouseDown);
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });

        // --- 双击编辑：直接修改 el.textContent ---
        el.addEventListener('dblclick', (ev) => {
            ev.stopPropagation();
            const current = el.textContent || '';
            const input = prompt('编辑通道标签文字：', current);
            if (input !== null) {
                el.textContent = input;
                if (chartType === 'HF') channelLabelsHF[i] = input;
                else channelLabelsLF[i] = input;
            }
        });
    }

    // 渲染完成时更新箭头位置
    chart.on?.('finished', () => updateArrowPositions(chart, chartType));
    window.addEventListener('resize', () => updateArrowPositions(chart, chartType));
}

/**
 * 添加测量线（最多保留两个，若超出则移除最旧的），并返回该测量线与所有通道的交点
 * @param {echarts.ECharts} chart
 * @param {Array<Array<Array<number>>>} buffers
 * @param {Array<Object>} linesArray
 * @param {number} xValue
 */
function addMeasurementLine(chart, buffers, linesArray, xValue) {
    // 保证最多两个
    if (linesArray.length >= 2) {
        linesArray.shift();
    }
    linesArray.push({ x: xValue });
    updateMeasurementLinesOnChart(chart, linesArray);
    const intersections = computeIntersections(buffers, xValue);
    console.log('Measurement at x=', xValue, intersections);
    return intersections;
}

/**
 * 处理图表的鼠标按下事件：左键或右键都用于添加测量线（分别触发）
 */
function handleChartMouseDown(e, chart, buffers, linesArray) {
    if (!isMeasurementEnabled) return;
    // 仅响应左右键（0=左,2=右）
    if (e.button !== 0 && e.button !== 2) return;
    // 阻止右键默认菜单
    if (e.button === 2) e.preventDefault();
    // 将像素坐标转换为数据坐标
    const rect = chart.getDom().getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    // 如果点击发生在图表上方的标题/图例区域，忽略该点击（避免点击图例触发测量线）
    try {
        const opt = chart.getOption();
        let gridTop = 0;
        if (opt && opt.grid && opt.grid[0] && opt.grid[0].top !== undefined) {
            gridTop = opt.grid[0].top;
        } else {
            gridTop = 80; // fallback 与 baseOption 保持一致
        }
        // gridTop 可能为百分比字符串或数字
        let gridTopPx = 0;
        if (typeof gridTop === 'string' && gridTop.indexOf('%') !== -1) {
            gridTopPx = parseFloat(gridTop) / 100 * rect.height;
        } else {
            gridTopPx = Number(gridTop);
        }
        // 如果点击 Y 坐标在绘图区上方一定范围内，则判断为点击标题/图例，忽略
        if (offsetY < gridTopPx) {
            return;
        }
    } catch (err) {
        // ignore and continue
    }
    const dataPoint = chart.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [offsetX, offsetY]);
    const xValue = dataPoint[0];
    const points = addMeasurementLine(chart, buffers, linesArray, xValue);
    // 同时返回并打印交点信息（开发者可调用 window.getMeasurements）
    return points;
}

/**
 * 暴露给外部的获取测量结果的函数
 */
window.getMeasurements = function (chartType) {
    if (chartType === 'HF') {
        return measurementLinesHF.map(l => ({ x: l.x, points: computeIntersections(dataBuffersHF, l.x) }));
    } else if (chartType === 'LF') {
        return measurementLinesLF.map(l => ({ x: l.x, points: computeIntersections(dataBuffersLF, l.x) }));
    }
    return null;
};

/**
 * 清除两张图的所有测量线并更新显示
 */
function clearAllMeasurements() {
    measurementLinesHF.length = 0;
    measurementLinesLF.length = 0;
    if (chartHF) deleteMeasurementLinesOnChart(chartHF, measurementLinesHF);
    if (chartLF) deleteMeasurementLinesOnChart(chartLF, measurementLinesLF);
    console.log('All measurement lines cleared.');
}

// 暴露接口
window.clearMeasurements = clearAllMeasurements;

/**
 * 初始化控制面板（下拉框）
 */
function initControls() {
    // 为健壮性在函数内部重新获取 DOM 元素
    const chSelect = document.getElementById('channel-select');
    const rgSelect = document.getElementById('range-select');

    // 绑定测量开关按钮
    try {
        const toggleBtn = document.getElementById('toggle-measurement-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function(ev) {
                ev.preventDefault();
                ev.stopPropagation();
                isMeasurementEnabled = !isMeasurementEnabled;
                // 更新按钮文字和样式
                this.textContent = isMeasurementEnabled ? '停止测量' : '开始测量';
                this.style.background = isMeasurementEnabled ? '#d32f2f' : '#4CAF50'; // 红色表示测量中
                console.log('测量已', isMeasurementEnabled ? '开启' : '关闭');
            });
        } else {
            console.warn('toggle-measurement-btn 未找到');
        }
    } catch (err) {
        console.error('绑定测量开关按钮失败', err);
    }


    if (!chSelect || !rgSelect) {
        console.warn('initControls: channel-select 或 range-select 未找到。');
        return;
    }

    // 填充CH下拉框
    for (let i = 0; i < NUM_CHANNELS; i++) {
        const hfChannelId = `HF_${i + 1}`;
        const lfChannelId = `LF_${i + 1}`;

        let optionHF = document.createElement('option');
        optionHF.value = hfChannelId;
        optionHF.textContent = `高频 ${i + 1} 通道`;
        chSelect.appendChild(optionHF);

        let optionLF = document.createElement('option');
        optionLF.value = lfChannelId;
        optionLF.textContent = `低频 ${i + 1} 通道`;
        chSelect.appendChild(optionLF);

        // 为所有通道设置默认量程
        channelRanges.set(hfChannelId, '5V');
        channelRanges.set(lfChannelId, '5V');
    }

    // 填充量程下拉框
    rangeToYAxisMap.forEach((_, rangeString) => {
        let option = document.createElement('option');
        option.value = rangeString;
        option.textContent = rangeString;
        rgSelect.appendChild(option);
    });

    // 设置初始选中项
    currentSelectedChannelId = 'HF_1';
    chSelect.value = currentSelectedChannelId;
    rgSelect.value = channelRanges.get(currentSelectedChannelId);

    // 添加事件监听器
    chSelect.addEventListener('change', (event) => {
        currentSelectedChannelId = event.target.value;
        rgSelect.value = channelRanges.get(currentSelectedChannelId);
        applyRangeToChart();
    });

    rgSelect.addEventListener('change', (event) => {
        const selectedRange = event.target.value;
        channelRanges.set(currentSelectedChannelId, selectedRange);
        applyRangeToChart();
    });

    // 绑定清除测量按钮（确保始终绑定，即使前面出错也会尝试）
    try {
        const clearBtn = document.getElementById('clear-measurements-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                clearAllMeasurements();
            });
        } else {
            console.warn('clear-measurements-btn 未找到');
        }
    } catch (err) {
        console.error('initControls bind clear button failed', err);
    }
}

// 初始化图表
function initCharts() {
    // 初始化控制面板
    initControls();

    // 初始化高频图
    chartHF = echarts.init(document.getElementById('chart-hf'), null, {
        renderer: 'canvas' ,
        useCoarsePointer: true,    // 直接挂载，5.4.0+
        pointerSize: 44           // 直接挂载，5.4.0+
    });
    // 初始化低频图
    chartLF = echarts.init(document.getElementById('chart-lf'), null, {
        renderer: 'canvas',
        useCoarsePointer: true,    // 直接挂载，5.4.0+
        pointerSize: 44           // 直接挂载，5.4.0+
    });


    // 生成图例数据
     // 生成图例数据（仅用于自定义图例）
    const hfLegendData = Array.from({ length: NUM_CHANNELS }, (_, i) => `HF Channel ${i + 1}`);
    const lfLegendData = Array.from({ length: NUM_CHANNELS }, (_, i) => `LF Channel ${i + 1}`);

    // 基础图表配置
    const baseOption = {
        animation: false, // 禁用所有动画，提高性能
        grid: {
            left: 50,
            right: 70,
            top: 80, // 稍微增加顶部边距，为水平图例和标题留出更多空间
            bottom: 30
        },
        xAxis: {
            type: 'value',
            // inverse: true, // 关键：反转X轴，使最新数据在左侧
            min: 0, // 固定显示窗口的最小索引
            max: POINTS_PER_CHANNEL - 1, // 固定显示窗口的最大索引
            splitLine: { show: false }, // 不显示X轴网格线
            axisTick: { show: true },
            axisLine: { show: true },
            axisLabel: {
                show: true,
                // 将当前数值坐标（样本索引）映射为时间（µs）显示，固定映射 0..POINTS_PER_CHANNEL-1 -> 0..1.5 µs
                formatter: function (val) {
                    const sampleCount = (POINTS_PER_CHANNEL - 1) || 1;
                    const sampleTimeUs = 1.5 / sampleCount; // 每个样本对应的 µs
                    const rel = val * sampleTimeUs;
                    const clamped = Math.max(0, Math.min(1.5, rel));
                    return clamped.toFixed(2) + ' µs';
                }
            },
            splitNumber: 3 // 产生 4 个刻度：0,0.5,1.0,1.5
        },
        yAxis: {
            type: 'value',
            splitLine: { show: false }, // 不显示Y轴网格线
            axisTick: { show: true },
            axisLine: { show: true },
            axisLabel: {
                show: true,
                formatter: function (val) {
                    // 将 Y 值（单位为 V）转换为 mV 并显示
                    return (val * 1000).toFixed(1) + ' mV';
                }
            },
            name: 'mV'
        },
        // 添加图例配置
        legend: {
            orient: 'horizontal', // 水平排列
            right: 10, // 距离右侧10px
            top: 0, // 距离顶部30px
            textStyle: {
                color: '#333' // 图例文字颜色，适应白色背景
            },
            itemGap: 10, // 图例项之间的间隔
            // itemWidth: 36, // 图例标记的宽度
            // itemHeight: 57, // 图例标记的高度
            // data 属性将在 hfOption 和 lfOption 中单独设置
        },
        // **新增：dataZoom 配置**
        dataZoom: [
            // {
            //     type: 'inside', // 内置型数据区域缩放
            //     xAxisIndex: 0, // 作用于第一个X轴
            //     zoomOnMouseWheel: true, // 鼠标滚轮缩放X轴
            //     moveOnMouseMove: true, // 鼠标移动平移X轴
            //     moveOnMouseWheel: false, // 鼠标滚轮不平移X轴
            //     preventDefaultMouseMove: false, // 不阻止默认的鼠标移动行为
            //     filterMode: 'none' // 过滤数据，只显示在范围内的数据
            // },
            {
                type: 'inside', // 内置型数据区域缩放
                yAxisIndex: 0, // 作用于第一个Y轴
                zoomOnMouseWheel: true, // 鼠标滚轮缩放Y轴
                moveOnMouseMove: true, // 鼠标移动平移Y轴
                moveOnMouseWheel: false, // 鼠标滚轮不平移Y轴
                preventDefaultMouseMove: false,
                filterMode: 'none' // Y轴缩放不隐藏其他数据，只改变显示范围
            }
        ],
        series: []
    };

    // 高频图配置
    const hfOption = JSON.parse(JSON.stringify(baseOption)); // 深拷贝基础配置
    hfOption.xAxis.name = '时间 (µs)';
    hfOption.xAxis.axisLabel.formatter = function (val) {
        const totalSamples = POINTS_PER_CHANNEL - 1; // 2599
        const usPerSample = 20 / totalSamples;       // 每个采样点对应微秒数
        const us = val * usPerSample;
        const clamped = Math.max(0, Math.min(20, us));
        return clamped.toFixed(2) + ' µs';
    };
    // hfOption.title = {
    //     text: '高频波形图',
    //     left: 'center',
    //     textStyle: {
    //         color: '#333',
    //         fontSize: 16
    //     }
    // };
    // 初始Y轴范围，使用一个足够大的默认量程，例如5V，确保所有通道都能大致显示
    const defaultRangeConfig = rangeToYAxisMap.get('5V');
    // 初始Y轴范围应覆盖所有通道的中心线，并加上默认量程的半跨度
    const defaultYMinHF = getVerticalOffset(0, 'HF') - defaultRangeConfig.span / 2;
    const defaultYMaxHF = getVerticalOffset(NUM_CHANNELS - 1, 'HF') + defaultRangeConfig.span / 2;
    hfOption.yAxis.min = defaultYMinHF;
    hfOption.yAxis.max = defaultYMaxHF;
    hfOption.legend = { show: false };
    // 1--
    // 设置高频图的图例数据，并仅默认显示前 3 条通道
    // hfOption.legend.data = hfLegendData; // 设置高频图的图例数据
    // const hfSelectedMap = {};
    // for (let i = 0; i < NUM_CHANNELS; i++) {
    //     hfSelectedMap[`HF Channel ${i + 1}`] = i < 3; // 仅前三条默认选中
    // }
    // hfOption.legend.selected = hfSelectedMap;

    for (let i = 0; i < NUM_CHANNELS; i++) {
        const initDataHF = generateNewSeriesData(i, 0.05, 1.0, channelStatesHF);
        dataBuffersHF[i] = initDataHF.slice();
        hfOption.series.push({
            name: `HF Channel ${i + 1}`,
            type: 'line',
            color: channelColorsHF[i],
            showSymbol: false,
            hoverAnimation: false,
            lineStyle: { width: 1, opacity: 0.8, color: channelColorsHF[i] },
            itemStyle: { color: channelColorsHF[i] },
            data: channelVisibleHF[i] ? initDataHF.slice() : [], // 根据显隐状态
            large: true,
            largeThreshold: 2000
        });
    }
    chartHF.setOption(hfOption);
    createCustomLegend(chartHF, 'HF', channelColorsHF, channelLabelsHF);

    // 绑定鼠标事件以添加测量线
    chartHF.getDom().addEventListener('mousedown', function (e) {
        handleChartMouseDown(e, chartHF, dataBuffersHF, measurementLinesHF);
    });
    chartHF.getDom().addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // 创建右侧箭头控件
    createArrowControls(chartHF, 'HF');
    arrowElemsHF.forEach((el, idx) => {
        if (el) {
            el.dataset.legendVisible = channelVisibleHF[idx] ? 'true' : 'false';
        }
    });

    // 同步箭头的 legendVisible 状态到初始选中状态
    // (function syncHFArrowsInitial() {
    //     const sel = hfOption.legend && hfOption.legend.selected ? hfOption.legend.selected : {};
    //     for (let i = 0; i < NUM_CHANNELS; i++) {
    //         const el = arrowElemsHF[i];
    //         if (el) el.dataset.legendVisible = sel[`HF Channel ${i + 1}`] ? 'true' : 'false';
    //     }
    // })();
    updateArrowPositions(chartHF, 'HF');
    // 监听图例切换，更新对应箭头的可见性标记并刷新位置
    // chartHF.on && chartHF.on('legendselectchanged', function (params) {
    //     console.log('HF legendselectchanged--', params);
    //     for (let i = 0; i < NUM_CHANNELS; i++) {
    //         const name = `HF Channel ${i + 1}`;
    //         const visible = !!params.selected[name];
    //         const el = arrowElemsHF[i];
    //         if (el) {
    //             el.dataset.legendVisible = visible ? 'true' : 'false';
    //         }
    //     }
    //     // 立即刷新箭头位置以反映可见性变化
    //     updateArrowPositions(chartHF, 'HF');
    //     // 同步箭头颜色（以防外部修改了 channelColors）
    //     for (let i = 0; i < NUM_CHANNELS; i++) {
    //         const el = arrowElemsHF[i];
    //         if (el) el.style.background = channelColorsHF[i];
    //     }
    // });

    // 低频图配置
    const lfOption = JSON.parse(JSON.stringify(baseOption)); // 深拷贝基础配置
    lfOption.xAxis.name = '时间 (ms)';
    lfOption.xAxis.axisLabel.formatter = function (val) {
        const totalSamples = POINTS_PER_CHANNEL - 1; // 2599
        const msPerSample = 5 / totalSamples;        // 每个采样点对应毫秒数
        const ms = val * msPerSample;
        const clamped = Math.max(0, Math.min(5, ms));
        return clamped.toFixed(2) + ' ms';
    };

    // lfOption.title = {
    //     text: '低频波形图',
    //     left: 'center',
    //     textStyle: {
    //         color: '#333',
    //         fontSize: 16
    //     }
    // };
    const defaultYMinLF = getVerticalOffset(0, 'LF') - defaultRangeConfig.span / 2;
    const defaultYMaxLF = getVerticalOffset(NUM_CHANNELS - 1, 'LF') + defaultRangeConfig.span / 2;
    lfOption.yAxis.min = defaultYMinLF;
    lfOption.yAxis.max = defaultYMaxLF;

    lfOption.legend = { show: false };   //
    //1--
    // lfOption.legend.data = lfLegendData; // 设置低频图的图例数据
    // const lfSelectedMap = {};
    // for (let i = 0; i < NUM_CHANNELS; i++) {
    //     lfSelectedMap[`LF Channel ${i + 1}`] = i < 3;
    // }
    // lfOption.legend.selected = lfSelectedMap;

    for (let i = 0; i < NUM_CHANNELS; i++) {
        const initDataLF = generateNewSeriesData(i, 0.01, 0.5, channelStatesLF);
        dataBuffersLF[i] = initDataLF.slice();
        lfOption.series.push({
            name: `LF Channel ${i + 1}`,
            type: 'line',
            color: channelColorsLF[i],
            showSymbol: false,
            hoverAnimation: false,
            lineStyle: {
                width: 1,
                opacity: 0.8,
                color: channelColorsLF[i]
            },
            itemStyle: { color: channelColorsLF[i] },
            data: channelVisibleLF[i] ? initDataLF.slice() : [], // ✅
            large: true,
            largeThreshold: 2000
        });
    }
    chartLF.setOption(lfOption);
    createCustomLegend(chartLF, 'LF', channelColorsLF, channelLabelsLF);

    chartLF.getDom().addEventListener('mousedown', function (e) {
        handleChartMouseDown(e, chartLF, dataBuffersLF, measurementLinesLF);
    });
    chartLF.getDom().addEventListener('contextmenu', function (e) { e.preventDefault(); });
    createArrowControls(chartLF, 'LF');
    // (function syncLFArrowsInitial() {
    //     const sel = lfOption.legend && lfOption.legend.selected ? lfOption.legend.selected : {};
    //     for (let i = 0; i < NUM_CHANNELS; i++) {
    //         const el = arrowElemsLF[i];
    //         if (el) el.dataset.legendVisible = sel[`LF Channel ${i + 1}`] ? 'true' : 'false';
    //     }
    // })();
    arrowElemsLF.forEach((el, idx) => {
        if (el) {
            el.dataset.legendVisible = channelVisibleLF[idx] ? 'true' : 'false';
        }
    });
    updateArrowPositions(chartLF, 'LF');
    // chartLF.on && chartLF.on('legendselectchanged', function (params) {
    //     for (let i = 0; i < NUM_CHANNELS; i++) {
    //         const name = `LF Channel ${i + 1}`;
    //         const visible = !!params.selected[name];
    //         const el = arrowElemsLF[i];
    //         if (el) {
    //             el.dataset.legendVisible = visible ? 'true' : 'false';
    //         }
    //     }
    //     updateArrowPositions(chartLF, 'LF');
    //     for (let i = 0; i < NUM_CHANNELS; i++) {
    //         const el = arrowElemsLF[i];
    //         if (el) el.style.background = channelColorsLF[i];
    //     }
    // });

    // 初始应用量程，确保页面加载时Y轴是正确的
    applyRangeToChart();
}

// 更新图表数据 - 每次生成全新的波形，并应用显隐状态
function updateCharts() {
    // 更新高频图数据缓存
    for (let i = 0; i < NUM_CHANNELS; i++) {
        const newData = generateNewSeriesData(i, 0.05, 1.0, channelStatesHF);
        dataBuffersHF[i] = newData.slice();
    }

    // 更新低频图数据缓存
    for (let i = 0; i < NUM_CHANNELS; i++) {
        const newData = generateNewSeriesData(i, 0.01, 0.5, channelStatesLF);
        dataBuffersLF[i] = newData.slice();
    }

    // 准备高频图 series 更新（根据显隐状态决定是否传空数组）
    const hfSeriesUpdate = dataBuffersHF.map((buf, idx) => ({
        seriesIndex: idx,
        data: channelVisibleHF[idx] ? buf.slice() : []
    }));

    // 准备低频图 series 更新
    const lfSeriesUpdate = dataBuffersLF.map((buf, idx) => ({
        seriesIndex: idx,
        data: channelVisibleLF[idx] ? buf.slice() : []
    }));

    // 批量更新图表
    if (chartHF) {
        chartHF.setOption({ series: hfSeriesUpdate }, false);
    }
    if (chartLF) {
        chartLF.setOption({ series: lfSeriesUpdate }, false);
    }

    // 更新箭头位置
    if (chartHF) updateArrowPositions(chartHF, 'HF');
    if (chartLF) updateArrowPositions(chartLF, 'LF');
}

/**
 * 自定义 HTML 图例（终极版）
 * - 点击切换通道显隐状态
 * - 状态持久化，波形刷新后依然保持
 * - 完全不依赖 ECharts 原生图例，蓝牙鼠标点击丝滑
 */
function createCustomLegend(chart, chartType, colors, labels) {
    const container = chart.getDom();
    if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
    }

    const legendClass = `custom-echarts-legend-${chartType}`;
    const oldLegend = container.querySelector(`.${legendClass}`);
    if (oldLegend) oldLegend.remove();

    const legendDiv = document.createElement('div');
    legendDiv.className = `custom-echarts-legend ${legendClass}`;
    Object.assign(legendDiv.style, {
        position: 'absolute',
        top: '10px',
        left: '80px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        zIndex: '3000',
        pointerEvents: 'auto',
        fontSize: '12px',
        fontFamily: 'sans-serif'
    });

    // 获取当前图表对应的显隐状态数组
    const visibleArray = chartType === 'HF' ? channelVisibleHF : channelVisibleLF;

    labels.forEach((label, i) => {
        const seriesName = `${chartType} Channel ${i + 1}`;
        const isVisible = visibleArray[i]; // 从状态数组读取

        const item = document.createElement('span');
        item.dataset.index = i;
        item.dataset.name = seriesName;
        Object.assign(item.style, {
            display: 'inline-flex',
            alignItems: 'center',
            padding: '6px 16px',
            background: isVisible ? colors[i] : '#aaa',
            color: '#fff',
            borderRadius: '20px',
            cursor: 'pointer',
            transition: 'background 0.2s',
            whiteSpace: 'nowrap'
        });

        const marker = document.createElement('span');
        Object.assign(marker.style, {
            display: 'inline-block',
            width: '12px',
            height: '12px',
            background: colors[i],
            marginRight: '8px',
            borderRadius: '2px'
        });

        const text = document.createElement('span');
        text.textContent = label;

        item.appendChild(marker);
        item.appendChild(text);
        legendDiv.appendChild(item);

        // 点击事件：切换状态数组 + 更新图表 + 更新自身背景
        // 点击事件：切换状态数组 + 更新图表 + 更新自身背景
        item.addEventListener('click', (e) => {
            e.stopPropagation();

            // 1. 切换显隐状态
            visibleArray[i] = !visibleArray[i];
            const newVisible = visibleArray[i];

            // 2. 更新当前图例项背景色
            item.style.background = newVisible ? colors[i] : '#aaa';

            const arrowArray = chartType === 'HF' ? arrowElemsHF : arrowElemsLF;
            if (arrowArray[i]) {
                arrowArray[i].dataset.legendVisible = newVisible ? 'true' : 'false';
            }
            updateArrowPositions(chart, chartType);

            // 3. 更新图表中对应 series 的数据

            const seriesIndex = i;

            let newData;
            if (newVisible) {
                // 显示：从全局数据缓存中恢复完整波形
                newData = chartType === 'HF' ? dataBuffersHF[i].slice() : dataBuffersLF[i].slice();
            } else {
                // 隐藏：设置为空数组
                newData = [];
            }

            chart.setOption({
                series: [{
                    index: seriesIndex,
                    data: newData
                }]
            }, false);
        });
    });

    container.appendChild(legendDiv);
}
// 启动图表和更新循环
initCharts();
setInterval(updateCharts, REFRESH_INTERVAL_MS);

window.addEventListener('resize', () => {
    chartHF.resize();
    chartLF.resize();
});

// 页面卸载时，销毁图表实例，释放内存
window.addEventListener('beforeunload', () => {
    if (chartHF) {
        chartHF.dispose();
    }
    if (chartLF) {
        chartLF.dispose();
    }
});
