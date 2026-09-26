/** 纯 Canvas 图表：折线 / 柱状 / 环形 / 迷你走势，无第三方依赖 */
import { el } from '../lib/dom.js';

const css = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

/** 把任意 CSS 颜色（hsl/hex/rgb/命名色）转成带透明度的 rgba */
function withAlpha(color, alpha) {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillStyle = color;
    const v = String(ctx.fillStyle);
    if (v.startsWith('#')) {
      const hex = v.length === 4
        ? v.slice(1).split('').map((c) => c + c).join('')
        : v.slice(1, 7);
      const n = parseInt(hex, 16);
      if (!Number.isNaN(n)) return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }
    const m = v.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const [r, g, b] = m[1].split(/[,\s/]+/).map(Number);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  } catch {
    /* 落到兜底 */
  }
  return color;
}

function setupCanvas(canvas, { height = 200 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 600;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function niceMax(value) {
  if (value <= 0) return 4;
  const mag = 10 ** Math.floor(Math.log10(value));
  const norm = value / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/** 折线 / 面积图 */
export function lineChart(data, { height = 220, labels = null, fill = true, smooth = true } = {}) {
  const canvas = el('canvas.chart');
  const wrap = el('div', {}, canvas);
  requestAnimationFrame(() => draw());

  function draw() {
    const { ctx, width } = setupCanvas(canvas, { height });
    const values = data.map((d) => Number(d.count ?? d.value ?? 0));
    const max = niceMax(Math.max(...values, 1));
    const pad = { top: 14, right: 12, bottom: 24, left: 34 };
    const w = width - pad.left - pad.right;
    const h = height - pad.top - pad.bottom;
    const gridColor = css('--chart-grid', '#e8ecf5');
    const textColor = css('--text-muted', '#7c879d');
    const brand = css('--brand', '#6366f1');
    const accent = css('--accent', '#22d3ee');

    ctx.clearRect(0, 0, width, height);

    // 网格 + Y 轴刻度
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (h / 4) * i;
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + w, y);
      ctx.stroke();
      ctx.fillStyle = textColor;
      ctx.fillText(String(Math.round(max - (max / 4) * i)), pad.left - 6, y);
    }

    if (!values.length) return;
    const stepX = values.length > 1 ? w / (values.length - 1) : w;
    const points = values.map((v, i) => ({
      x: pad.left + i * stepX,
      y: pad.top + h - (v / max) * h,
      v,
    }));

    // 面积
    if (fill) {
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + h);
      grad.addColorStop(0, withAlpha(brand, 0.33));
      grad.addColorStop(1, withAlpha(brand, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(points[0].x, pad.top + h);
      points.forEach((p, i) => {
        if (smooth && i > 0) {
          const prev = points[i - 1];
          const cx = (prev.x + p.x) / 2;
          ctx.bezierCurveTo(cx, prev.y, cx, p.y, p.x, p.y);
        } else ctx.lineTo(p.x, p.y);
      });
      ctx.lineTo(points[points.length - 1].x, pad.top + h);
      ctx.closePath();
      ctx.fill();
    }

    // 折线
    ctx.strokeStyle = brand;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((p, i) => {
      if (smooth && i > 0) {
        const prev = points[i - 1];
        const cx = (prev.x + p.x) / 2;
        ctx.bezierCurveTo(cx, prev.y, cx, p.y, p.x, p.y);
      } else if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // 数据点
    points.forEach((p) => {
      ctx.fillStyle = css('--surface', '#fff');
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = brand;
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // X 轴标签
    ctx.fillStyle = textColor;
    ctx.textBaseline = 'top';
    const labelSet = labels || data.map((d) => d.day || '');
    const maxLabels = Math.min(labelSet.length, Math.floor(w / 52));
    const stride = Math.ceil(labelSet.length / maxLabels);
    labelSet.forEach((label, i) => {
      if (i % stride !== 0) return;
      const x = points[i].x;
      ctx.textAlign = i === 0 ? 'left' : x > width - 40 ? 'right' : 'center';
      ctx.fillText(String(label).slice(5), x, pad.top + h + 8);
    });
  }

  window.addEventListener('resize', debounce(draw, 150));
  return wrap;
}

/** 柱状图（支持双色） */
export function barChart(data, { height = 200, colors = null } = {}) {
  const canvas = el('canvas.chart');
  const wrap = el('div', {}, canvas);
  requestAnimationFrame(() => draw());

  function draw() {
    const { ctx, width } = setupCanvas(canvas, { height });
    const values = data.map((d) => Number(d.value ?? d.count ?? 0));
    const max = niceMax(Math.max(...values, 1));
    const pad = { top: 12, right: 8, bottom: 26, left: 30 };
    const w = width - pad.left - pad.right;
    const h = height - pad.top - pad.bottom;
    const brand = css('--brand', '#6366f1');
    const accent = css('--accent', '#22d3ee');
    const gridColor = css('--chart-grid', '#e8ecf5');

    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i <= 3; i++) {
      const y = pad.top + (h / 3) * i;
      ctx.strokeStyle = gridColor;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + w, y);
      ctx.stroke();
    }
    if (!values.length) return;

    const slot = w / values.length;
    const bw = Math.min(slot * 0.62, 34);
    values.forEach((v, i) => {
      const barH = Math.max(2, (v / max) * h);
      const x = pad.left + i * slot + (slot - bw) / 2;
      const y = pad.top + h - barH;
      const grad = ctx.createLinearGradient(0, y, 0, pad.top + h);
      const c = colors?.[i] || (i % 2 === 0 ? brand : accent);
      grad.addColorStop(0, c);
      grad.addColorStop(1, withAlpha(c, 0.4));
      ctx.fillStyle = grad;
      roundRect(ctx, x, y, bw, barH, Math.min(4, bw / 2));
      ctx.fill();
    });

    ctx.fillStyle = css('--text-muted', '#7c879d');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labels = data.map((d) => d.label ?? d.hour ?? '');
    const stride = Math.ceil(values.length / Math.max(1, Math.floor(w / 46)));
    labels.forEach((label, i) => {
      if (i % stride !== 0) return;
      ctx.fillText(String(label), pad.left + i * slot + slot / 2, pad.top + h + 8);
    });
  }

  window.addEventListener('resize', debounce(draw, 150));
  return wrap;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** 环形图 */
export function donutChart(items, { size = 180, thickness = 22, centerLabel = '' } = {}) {
  const canvas = el('canvas');
  const wrap = el('div', { style: { position: 'relative', width: `${size}px`, height: `${size}px`, margin: '0 auto' } }, canvas);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const total = items.reduce((s, i) => s + i.value, 0);
  if (centerLabel) {
    wrap.append(
      el('div', {
        style: {
          position: 'absolute', inset: '0', display: 'grid', placeItems: 'center',
          textAlign: 'center', pointerEvents: 'none',
        },
      }, [
        el('div', {}, [el('div', { style: { fontSize: '1.4rem', fontWeight: '800' } }, centerLabel || String(total))]),
        el('div.small.muted', {}, '总计'),
      ]),
    );
  }
  requestAnimationFrame(() => draw());

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - thickness / 2 - 2;
    ctx.clearRect(0, 0, size, size);
    const palette = items.map((_, i) => items[i].color || css('--brand', '#6366f1'));
    if (total === 0) {
      ctx.strokeStyle = css('--surface-3', '#eef1f8');
      ctx.lineWidth = thickness;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    let start = -Math.PI / 2;
    items.forEach((item, i) => {
      const angle = (item.value / total) * Math.PI * 2;
      ctx.strokeStyle = palette[i];
      ctx.lineWidth = thickness;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + angle - 0.02);
      ctx.stroke();
      start += angle;
    });
  }
  return wrap;
}

export function chartLegend(items) {
  return el(
    'div.chart-legend',
    {},
    items.map((i) =>
      el('span', {}, [
        el('i', { style: { background: i.color || css('--brand', '#6366f1') } }),
        `${i.label} ${i.value}`,
      ]),
    ),
  );
}

/** GitHub 风格热力图 */
export function heatmap(days) {
  const max = Math.max(...days.map((d) => d.count), 1);
  const wrap = el('div.heat');
  days.forEach((d) => {
    const ratio = d.count / max;
    const level = d.count === 0 ? 0 : ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
    wrap.append(el('i', { dataset: { l: String(level) }, title: `${d.day}: ${d.count} 次` }));
  });
  return wrap;
}

function debounce(fn, wait) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), wait);
  };
}
