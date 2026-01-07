const COLORS = [
  '#2563eb',
  '#16a34a',
  '#ea580c',
  '#7c3aed',
  '#0891b2',
  '#e11d48',
  '#ca8a04',
  '#0f766e',
  '#9333ea',
];

const safeStr = (v) => (v === null || v === undefined ? '' : String(v));

function dateToDateOnly(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function joinDateOnlyFromTenureYears(u) {
  const v = Number(u.tenure_years);
  if (!Number.isFinite(v) || v <= 0) return '';
  const totalMonths = Math.round(v * 12);
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - totalMonths);
  return dateToDateOnly(d);
}

function buildDepartmentColors(departments) {
  const map = new Map();
  let idx = 0;
  for (const d of departments || []) {
    const key = d.department_id || d.name;
    if (!key || map.has(key)) continue;
    map.set(key, COLORS[idx % COLORS.length]);
    idx += 1;
  }
  return map;
}

function getDeptColor(u, colorMap) {
  const key = u.reported_department_id || u.reported_department_name;
  if (key && colorMap.has(key)) return colorMap.get(key);
  return '#94a3b8';
}

function buildHierarchy(people) {
  const nodes = new Map();
  const childrenByManager = new Map();

  for (const person of people) {
    nodes.set(person.id, { person, children: [] });
  }

  for (const person of people) {
    const managerId = safeStr(person.reports_to_user_id).trim();
    if (!managerId || managerId === person.id || !nodes.has(managerId)) {
      continue;
    }
    if (!childrenByManager.has(managerId)) {
      childrenByManager.set(managerId, []);
    }
    childrenByManager.get(managerId).push(person.id);
  }

  for (const [managerId, children] of childrenByManager.entries()) {
    const node = nodes.get(managerId);
    node.children = children.map((id) => nodes.get(id));
  }

  const roots = [];
  for (const person of people) {
    const managerId = safeStr(person.reports_to_user_id).trim();
    if (!managerId || managerId === person.id || !nodes.has(managerId)) {
      roots.push(nodes.get(person.id));
    }
  }

  return roots;
}

function layoutTree(roots) {
  let nextX = 0;
  const positions = new Map();
  let maxDepth = 0;

  function layout(node, depth) {
    if (!node) return;
    maxDepth = Math.max(maxDepth, depth);
    if (!node.children || node.children.length === 0) {
      positions.set(node.person.id, { x: nextX, y: depth });
      nextX += 1;
      return;
    }

    for (const child of node.children) {
      layout(child, depth + 1);
    }

    const childPositions = node.children.map((child) => positions.get(child.person.id).x);
    const minX = Math.min(...childPositions);
    const maxX = Math.max(...childPositions);
    positions.set(node.person.id, { x: (minX + maxX) / 2, y: depth });
  }

  for (const root of roots) {
    layout(root, 0);
    nextX += 1;
  }

  return { positions, maxDepth, maxX: Math.max(0, nextX - 1) };
}

function countDirectReports(people) {
  const counts = new Map();
  for (const person of people) {
    const managerId = safeStr(person.reports_to_user_id).trim();
    if (!managerId || managerId === person.id) continue;
    counts.set(managerId, (counts.get(managerId) || 0) + 1);
  }
  return counts;
}

function createSvgElement(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

export class OrgChart {
  constructor({ container, wrapper, zoomInButton, zoomOutButton, resetButton, fullscreenButton }) {
    this.container = container;
    this.wrapper = wrapper;
    this.zoomInButton = zoomInButton;
    this.zoomOutButton = zoomOutButton;
    this.resetButton = resetButton;
    this.fullscreenButton = fullscreenButton;
    this.scale = 1;
    this.translate = { x: 0, y: 0 };
    this.dragging = false;
    this.lastPoint = null;
    this.tooltip = null;

    this.bindControls();
  }

  bindControls() {
    if (this.zoomInButton) {
      this.zoomInButton.addEventListener('click', () => this.setScale(this.scale + 0.1));
    }
    if (this.zoomOutButton) {
      this.zoomOutButton.addEventListener('click', () => this.setScale(this.scale - 0.1));
    }
    if (this.resetButton) {
      this.resetButton.addEventListener('click', () => this.resetView());
    }
    if (this.fullscreenButton) {
      this.fullscreenButton.addEventListener('click', () => this.toggleFullscreen());
    }
  }

  resetView() {
    this.scale = 1;
    this.translate = { x: 0, y: 0 };
    this.applyTransform();
  }

  setScale(value) {
    this.scale = Math.min(2.5, Math.max(0.5, value));
    this.applyTransform();
  }

  toggleFullscreen() {
    if (!this.wrapper) return;
    this.wrapper.classList.toggle('fullscreen');
  }

  applyTransform() {
    if (!this.graphGroup) return;
    this.graphGroup.setAttribute(
      'transform',
      `translate(${this.translate.x}, ${this.translate.y}) scale(${this.scale})`,
    );
  }

  render(people, departments, usersById = new Map()) {
    if (!this.container) return;
    this.container.innerHTML = '';
    if (!people || people.length === 0) {
      this.container.innerHTML = '<div class="empty">Brak danych do wyświetlenia.</div>';
      return;
    }

    const colorMap = buildDepartmentColors(departments);
    const directReports = countDirectReports(people);
    const roots = buildHierarchy(people);
    const { positions, maxDepth, maxX } = layoutTree(roots);

    const spacingX = 140;
    const spacingY = 120;
    const margin = 60;
    const width = (maxX + 1) * spacingX + margin * 2;
    const height = (maxDepth + 1) * spacingY + margin * 2;

    const svg = createSvgElement('svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const group = createSvgElement('g');
    svg.appendChild(group);
    this.graphGroup = group;
    this.resetView();

    for (const node of roots) {
      this.drawConnections(node, positions, group, spacingX, spacingY, margin);
    }

    for (const person of people) {
      const pos = positions.get(person.id);
      if (!pos) continue;
      const x = margin + pos.x * spacingX;
      const y = margin + pos.y * spacingY;
      const color = getDeptColor(person, colorMap);

      const circle = createSvgElement('circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', 14);
      circle.setAttribute('fill', color);
      circle.setAttribute('stroke', '#ffffff');
      circle.setAttribute('stroke-width', '3');

      const label = createSvgElement('text');
      label.setAttribute('x', x);
      label.setAttribute('y', y + 28);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '12');
      label.setAttribute('fill', '#0f172a');
      label.textContent = `${safeStr(person.first_name).trim()} ${safeStr(person.last_name).trim()}`.trim();

      group.appendChild(circle);
      group.appendChild(label);

      const tooltipText = this.buildTooltip(person, directReports.get(person.id) || 0, usersById);
      this.attachTooltip(circle, tooltipText);
    }

    this.container.appendChild(svg);
    this.setupPan(svg);
  }

  buildTooltip(person, directCount, usersById) {
    const name = `${safeStr(person.first_name).trim()} ${safeStr(person.last_name).trim()}`.trim();
    const dept = safeStr(person.reported_department_name).trim() || '(brak działu)';
    const joinDate = joinDateOnlyFromTenureYears(person) || '(brak)';
    const managerId = safeStr(person.reports_to_user_id).trim();
    const managerPerson = managerId ? usersById.get(managerId) : null;
    const managerName = managerPerson
      ? `${safeStr(managerPerson.first_name).trim()} ${safeStr(managerPerson.last_name).trim()}`.trim()
      : '(brak)';

    return [
      `<strong>${name || '(brak imienia i nazwiska)'}</strong>`,
      `Dział: ${dept}`,
      `Data dołączenia: ${joinDate}`,
      `Raportuje do: ${managerName || '(brak)'}`,
      `Liczba osób raportujących: ${directCount}`,
    ].join('<br />');
  }

  drawConnections(node, positions, group, spacingX, spacingY, margin) {
    if (!node.children) return;
    for (const child of node.children) {
      const parentPos = positions.get(node.person.id);
      const childPos = positions.get(child.person.id);
      if (!parentPos || !childPos) continue;

      const x1 = margin + parentPos.x * spacingX;
      const y1 = margin + parentPos.y * spacingY + 14;
      const x2 = margin + childPos.x * spacingX;
      const y2 = margin + childPos.y * spacingY - 14;

      const line = createSvgElement('path');
      const midY = (y1 + y2) / 2;
      line.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
      line.setAttribute('stroke', '#cbd5f5');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('fill', 'none');
      group.appendChild(line);

      this.drawConnections(child, positions, group, spacingX, spacingY, margin);
    }
  }

  attachTooltip(element, html) {
    if (!this.tooltip) {
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'org-chart-tooltip';
      this.container.appendChild(this.tooltip);
    }

    element.addEventListener('mouseenter', (event) => {
      this.tooltip.innerHTML = html;
      this.tooltip.classList.add('visible');
      this.positionTooltip(event);
    });

    element.addEventListener('mousemove', (event) => this.positionTooltip(event));

    element.addEventListener('mouseleave', () => {
      this.tooltip.classList.remove('visible');
    });
  }

  positionTooltip(event) {
    if (!this.tooltip) return;
    const rect = this.container.getBoundingClientRect();
    this.tooltip.style.left = `${event.clientX - rect.left}px`;
    this.tooltip.style.top = `${event.clientY - rect.top - 10}px`;
  }

  setupPan(svg) {
    svg.addEventListener('mousedown', (event) => {
      this.dragging = true;
      this.lastPoint = { x: event.clientX, y: event.clientY };
    });

    window.addEventListener('mouseup', () => {
      this.dragging = false;
      this.lastPoint = null;
    });

    window.addEventListener('mousemove', (event) => {
      if (!this.dragging || !this.lastPoint) return;
      const dx = event.clientX - this.lastPoint.x;
      const dy = event.clientY - this.lastPoint.y;
      this.translate.x += dx;
      this.translate.y += dy;
      this.lastPoint = { x: event.clientX, y: event.clientY };
      this.applyTransform();
    });

    svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      this.setScale(this.scale + delta);
    });
  }
}
