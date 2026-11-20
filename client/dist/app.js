/* PlatePilot frontend — works with embedded engine (GitHub Pages / offline) */
import {
  GOAL_TARGETS,
  generateMealPlan,
  swapMeal,
  analyzeMess,
  buildGrocery,
} from './platepilot-engine.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const state = {
  plan: null,
  activeDay: 0,
  macroChart: null,
  targetChart: null,
  priceAdj: 0,
  recipes: [],
};

const SLOT_ORDER = ['breakfast', 'lunch', 'snack', 'dinner', 'extra'];
const SLOT_LABEL = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snack: 'Snack',
  dinner: 'Dinner',
  extra: 'Top-up Extra',
};

document.addEventListener('DOMContentLoaded', async () => {
  bindModals();
  try {
    await loadRecipes();
  } catch (e) {
    console.error(e);
  }
  try {
    loadCommunity();
    bindForm();
    bindChips();
    bindTopbar();
    bindMess();
    bindCommunity();
    bindPriceSlider();
    restoreLastPlan();
  } catch (e) {
    console.error('init error', e);
  }
});

async function loadRecipes() {
  // Prefer embedded data (works on GitHub Pages); fall back to server API.
  if (window.PLATEPILOT_RECIPES?.length) {
    state.recipes = window.PLATEPILOT_RECIPES;
    return;
  }
  try {
    const res = await fetch('./data/recipes.json');
    if (res.ok) {
      state.recipes = await res.json();
      return;
    }
  } catch (_) {}
  // last resort: server
  try {
    const res = await fetch('/api/recipes');
    state.recipes = await res.json();
  } catch (e) {
    console.error('Failed to load recipes', e);
    alert('Could not load recipe dataset.');
  }
}

function bindChips() {
  $$('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      $('#budget').value = chip.dataset.budget;
    });
  });
}

function bindPriceSlider() {
  $('#priceAdj').addEventListener('input', (e) => {
    state.priceAdj = Number(e.target.value);
    $('#priceAdjVal').textContent = `${state.priceAdj > 0 ? '+' : ''}${state.priceAdj}%`;
    if (state.plan) applyPriceAdjustmentToDisplay();
  });
}

function bindForm() {
  $('#profilerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await generatePlan();
  });
}

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = false;
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = true;
  el.classList.remove('open');
  document.body.style.overflow = '';
}

function bindModals() {
  ['historyModal', 'swapModal'].forEach((id) => {
    const modal = document.getElementById(id);
    if (!modal) return;
    // click backdrop closes
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(id);
    });
  });

  const closeBtn = document.getElementById('historyClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeModal('historyModal');
    });
  }

  const cancelBtn = document.getElementById('swapCancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeModal('swapModal');
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal('historyModal');
      closeModal('swapModal');
    }
  });
}

function bindTopbar() {
  $('#btnHistory').addEventListener('click', showHistory);
  $('#btnExport').addEventListener('click', () => window.print());
  $('#btnPantryMode').addEventListener('click', () => {
    document.body.classList.toggle('show-pantry');
    renderGrocery();
  });
}

async function generatePlan() {
  const btn = $('#btnGenerate');
  btn.disabled = true;
  btn.textContent = 'Optimizing knapsack…';
  try {
    const budget = Number($('#budget').value);
    const diet = $('#diet').value;
    const goal = $('#goal').value;
    const days = Number($('#days').value);
    const pantry = $('#pantry').value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Simulate a short delay so the UI feedback is visible
    await new Promise((r) => setTimeout(r, 250));

    const data = generateMealPlan(state.recipes, { budget, diet, goal, days, pantry });
    state.plan = data;
    state.activeDay = 0;
    renderPlan();
    renderGrocery();
    savePlan(data);
  } catch (err) {
    alert(err.message || 'Could not generate plan');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Budget Diet Plan';
  }
}

function applyPriceAdjustmentToDisplay() {
  if (!state.plan) return;
  const factor = 1 + state.priceAdj / 100;
  renderPlan(true, factor);
}

function renderPlan(priceOnly = false, factor = 1) {
  const plan = state.plan;
  if (!plan) return;

  $('#planEmpty').hidden = true;
  $('#planContent').hidden = false;

  const day = plan.week[state.activeDay];
  const dietLabel = { veg: 'Vegetarian', nonveg: 'Non-Veg', vegan: 'Vegan' }[plan.diet] || plan.diet;
  const goalLabel = {
    loss: 'Weight Loss',
    gain: 'Muscle Gain',
    maintain: 'Maintenance',
    highprotein: 'High Protein',
  }[plan.goal] || plan.goal;

  $('#planTitle').textContent = plan.week.length > 1 ? 'Your 7-Day Budget Meal Plan' : 'Your Budget Meal Plan';
  $('#planMeta').textContent = `${dietLabel} · ${goalLabel} · ₹${plan.dailyBudget}/day · ${day.label}`;

  const spent = day.totals.cost;
  const budget = plan.dailyBudget;
  $('#costSpent').textContent = `₹${Math.round(spent * factor)}`;
  $('#costBudget').textContent = `₹${budget}`;
  const pct = Math.min(100, (spent / budget) * 100);
  $('#costFill').style.width = `${pct}%`;
  $('#costFill').classList.toggle('over', spent > budget);

  const t = plan.targets;
  const totals = day.totals;
  $('#tKcal').textContent = totals.kcal;
  $('#tProtein').textContent = `${totals.protein}g`;
  $('#tCarbs').textContent = `${totals.carbs}g`;
  $('#tFat').textContent = `${totals.fat}g`;
  $('#tKcalTarget').textContent = `/ ${t.kcal} kcal target`;
  $('#tProteinTarget').textContent = `/ ${t.protein}g target`;
  $('#tCarbsTarget').textContent = `/ ${t.carbs}g target`;
  $('#tFatTarget').textContent = `/ ${t.fat}g target`;

  const tabs = $('#dayTabs');
  tabs.innerHTML = '';
  if (plan.week.length > 1) {
    plan.week.forEach((d, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `day-tab${i === state.activeDay ? ' active' : ''}`;
      b.textContent = d.label;
      b.addEventListener('click', () => {
        state.activeDay = i;
        renderPlan();
      });
      tabs.appendChild(b);
    });
  }

  renderMeals(day, factor);
  renderCharts(day, t);
  $('#groceryPanel').hidden = false;
}

function renderMeals(day, factor) {
  const grid = $('#mealsGrid');
  grid.innerHTML = '';

  const meals = [...day.meals].sort(
    (a, b) => SLOT_ORDER.indexOf(a.type) - SLOT_ORDER.indexOf(b.type)
  );

  for (const meal of meals) {
    const card = document.createElement('article');
    card.className = 'meal-card';
    card.dataset.id = meal.id;

    const cost = Math.round(meal.cost * factor);
    const pantryHits = meal.pantryMatches || [];

    card.innerHTML = `
      <span class="slot">${SLOT_LABEL[meal.type] || meal.type}</span>
      <span class="cost-badge">₹${cost}</span>
      <h3>${escapeHtml(meal.name)}</h3>
      <div class="macros">
        <span><b>${meal.kcal}</b> kcal</span>
        <span><b>${meal.protein}g</b> P</span>
        <span><b>${meal.carbs}g</b> C</span>
        <span><b>${meal.fat}g</b> F</span>
        <span>⏱ ${meal.prepMin}m</span>
      </div>
      ${pantryHits.length ? `<span class="pantry-tag">Uses pantry: ${pantryHits.join(', ')}</span>` : ''}
      <div class="ingredients">
        <strong>Cost breakdown:</strong>
        ${meal.ingredients.map((i) => `${escapeHtml(i.name)} ₹${i.cost}`).join(' · ')}
        = <strong>₹${meal.cost}</strong>
      </div>
      <p class="recipe">${escapeHtml(meal.recipe)}</p>
      <div class="actions">
        <button type="button" class="ghost" data-act="recipe">Recipe</button>
        <button type="button" class="primary" data-act="swap">Swap</button>
      </div>
    `;

    card.querySelector('[data-act="recipe"]').addEventListener('click', () => {
      card.classList.toggle('open');
    });
    card.querySelector('[data-act="swap"]').addEventListener('click', () => openSwap(meal));

    grid.appendChild(card);
  }
}

function renderCharts(day, targets) {
  const totals = day.totals;
  const pK = totals.protein * 4;
  const cK = totals.carbs * 4;
  const fK = totals.fat * 9;

  const macroCtx = $('#macroChart');
  const targetCtx = $('#targetChart');

  if (state.macroChart) state.macroChart.destroy();
  if (state.targetChart) state.targetChart.destroy();

  if (typeof Chart === 'undefined') return;

  Chart.defaults.color = '#8b9aab';
  Chart.defaults.borderColor = '#2d3844';

  state.macroChart = new Chart(macroCtx, {
    type: 'doughnut',
    data: {
      labels: ['Protein', 'Carbs', 'Fats'],
      datasets: [
        {
          data: [pK, cK, fK],
          backgroundColor: ['#ff6b6b', '#ffd93d', '#6bcbff'],
          borderWidth: 0,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      responsive: true,
      cutout: '62%',
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const grams = [totals.protein, totals.carbs, totals.fat][ctx.dataIndex];
              return ` ${ctx.label}: ${grams}g (${Math.round(ctx.raw)} kcal)`;
            },
          },
        },
      },
    },
  });

  state.targetChart = new Chart(targetCtx, {
    type: 'bar',
    data: {
      labels: ['Calories', 'Protein', 'Carbs', 'Fats'],
      datasets: [
        {
          label: 'Your Plan',
          data: [totals.kcal, totals.protein, totals.carbs, totals.fat],
          backgroundColor: ['#3ddc97', '#ff6b6b', '#ffd93d', '#6bcbff'],
          borderRadius: 6,
        },
        {
          label: 'RDA Target',
          data: [targets.kcal, targets.protein, targets.carbs, targets.fat],
          backgroundColor: 'rgba(139,154,171,.35)',
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true },
      },
    },
  });
}

let swapContext = null;

function openSwap(meal) {
  swapContext = meal;
  $('#swapHint').textContent = `Replacing "${meal.name}" (₹${meal.cost}) with a nutritionally similar, budget-compatible option.`;
  const opts = $('#swapOptions');
  opts.innerHTML = '<p class="hint">Finding alternatives…</p>';
  $('#swapModal') && openModal('swapModal');

  const plan = state.plan;
  const day = plan.week[state.activeDay];
  const avoidIds = day.meals.map((m) => m.id);

  try {
    const data = swapMeal(state.recipes, {
      mealId: meal.id,
      budget: plan.dailyBudget,
      diet: plan.diet,
      goal: plan.goal,
      avoidIds,
    });
    if (!data.swap) {
      opts.innerHTML = '<p class="hint">No suitable alternative found.</p>';
      return;
    }
    renderSwapOption(data.swap);
  } catch (err) {
    opts.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
  }
}

function renderSwapOption(alt) {
  const opts = $('#swapOptions');
  const meal = swapContext;
  const delta = alt.cost - meal.cost;
  opts.innerHTML = `
    <div class="swap-opt" id="swapPick">
      <strong>${escapeHtml(alt.name)} · ₹${alt.cost}</strong>
      <span>${alt.kcal} kcal · ${alt.protein}g protein · ${alt.carbs}g carbs · ${alt.fat}g fat</span>
      <span>Δ cost ${delta >= 0 ? '+' : ''}₹${delta} · ${alt.prepMin} min · ${alt.difficulty}</span>
      <span class="hint">${escapeHtml(alt.recipe)}</span>
    </div>
  `;
  $('#swapPick').addEventListener('click', () => applySwap(alt));
}

function applySwap(alt) {
  const day = state.plan.week[state.activeDay];
  const idx = day.meals.findIndex((m) => m.id === swapContext.id);
  if (idx >= 0) {
    const old = day.meals[idx];
    day.totals.kcal += alt.kcal - old.kcal;
    day.totals.protein += alt.protein - old.protein;
    day.totals.carbs += alt.carbs - old.carbs;
    day.totals.fat += alt.fat - old.fat;
    day.totals.cost += alt.cost - old.cost;
    day.meals[idx] = { ...alt, pantryMatches: old.pantryMatches || [] };
  }
  const pantry = ($('#pantry')?.value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  state.plan.grocery = buildGrocery(state.plan.week, pantry);
  closeModal('swapModal');
  renderPlan();
  renderGrocery();
  savePlan(state.plan);
}

function renderGrocery() {
  const plan = state.plan;
  if (!plan || !plan.grocery) return;
  const g = plan.grocery;
  const grid = $('#groceryGrid');
  grid.innerHTML = '';
  $('#groceryTotal').textContent = `Est. weekly spend ≈ ₹${g.totalEst} · ${g.itemCount} items`;

  for (const [cat, items] of Object.entries(g.categories)) {
    const box = document.createElement('div');
    box.className = 'grocery-cat';
    box.innerHTML = `<h4>${escapeHtml(cat)}</h4><ul>
      ${items
        .map(
          (i) => `
        <li class="${i.inPantry ? 'pantry' : ''}">
          <span>${escapeHtml(i.name)}${i.inPantry ? ' 🏠' : ''}</span>
          <span>~${roundQty(i.qty)} ${escapeHtml(i.unit)}</span>
        </li>`
        )
        .join('')}
    </ul>`;
    grid.appendChild(box);
  }
}

function roundQty(n) {
  return Math.round(n * 10) / 10;
}

function bindMess() {
  $('#btnMess').addEventListener('click', () => {
    const names = $('#messInput').value.split(',').map((s) => s.trim()).filter(Boolean);
    if (!names.length) return alert('Enter at least one mess dish');
    const budget = Number($('#budget').value) || 120;
    const diet = $('#diet').value;
    const goal = $('#goal').value;
    const messMenu = names.map((name) => ({ name, cost: estimateMessCost(name) }));

    try {
      const data = analyzeMess(messMenu, { budget, diet, goal }, state.recipes);
      renderMess(data);
    } catch (err) {
      alert(err.message);
    }
  });
}

function estimateMessCost(name) {
  const n = name.toLowerCase();
  if (/egg|chicken|fish|paneer/.test(n)) return 30;
  if (/dal|rice|roti|khichdi|poha|upma|idli/.test(n)) return 20;
  return 15;
}

function renderMess(data) {
  const el = $('#messResult');
  el.hidden = false;
  const picks = data.messPicks
    .map(
      (m) => `<div class="mess-pick"><span>✅ Pick: <strong>${escapeHtml(m.name)}</strong></span><span>₹${m.cost}</span></div>`
    )
    .join('');
  const supps = data.supplements
    .map(
      (s) =>
        `<div class="supp-pick"><span>🛒 Buy outside: <strong>${escapeHtml(s.name)}</strong> (${s.protein}g protein)</span><span>₹${s.cost}</span></div>`
    )
    .join('');
  el.innerHTML = `
    ${picks || '<div class="mess-pick"><span>No strong mess picks under budget share</span></div>'}
    <div class="mess-pick"><span>💰 Mess spend</span><span>₹${data.messSpent}</span></div>
    <div class="mess-pick"><span>💵 Left for supplements</span><span>₹${data.outsideBudget}</span></div>
    ${supps}
  `;
}

const COMM_KEY = 'platepilot_community';

function bindCommunity() {
  $('#communityForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const post = {
      title: $('#cTitle').value.trim(),
      cost: Number($('#cCost').value),
      desc: $('#cDesc').value.trim(),
      ts: Date.now(),
    };
    const list = loadCommunityList();
    list.unshift(post);
    localStorage.setItem(COMM_KEY, JSON.stringify(list.slice(0, 30)));
    e.target.reset();
    loadCommunity();
  });
}

function loadCommunityList() {
  try {
    return JSON.parse(localStorage.getItem(COMM_KEY)) || [];
  } catch {
    return [];
  }
}

function loadCommunity() {
  const feed = $('#communityFeed');
  const list = loadCommunityList();
  if (!list.length) {
    feed.innerHTML = `<div class="post"><h4>Be the first to share!</h4><p class="meta">Post a ₹-verified hostel meal hack.</p></div>`;
    return;
  }
  feed.innerHTML = list
    .map(
      (p) => `
    <div class="post">
      <h4>${escapeHtml(p.title)} · ₹${p.cost}</h4>
      <div class="meta">Shared ${new Date(p.ts).toLocaleString()}</div>
      <p>${escapeHtml(p.desc)}</p>
    </div>`
    )
    .join('');
}

function savePlan(plan) {
  try {
    localStorage.setItem('platepilot_last_plan', JSON.stringify(plan));
    const history = JSON.parse(localStorage.getItem('platepilot_history') || '[]');
    history.unshift({
      ts: Date.now(),
      budget: plan.dailyBudget,
      diet: plan.diet,
      goal: plan.goal,
      cost: plan.week[0]?.totals?.cost,
      kcal: plan.week[0]?.totals?.kcal,
      snapshot: plan,
    });
    localStorage.setItem('platepilot_history', JSON.stringify(history.slice(0, 10)));
  } catch (_) {}
}

function restoreLastPlan() {
  try {
    const raw = localStorage.getItem('platepilot_last_plan');
    if (!raw) return;
    const plan = JSON.parse(raw);
    if (plan?.week?.length) {
      state.plan = plan;
      state.activeDay = 0;
      $('#budget').value = plan.dailyBudget;
      $('#diet').value = plan.diet;
      $('#goal').value = plan.goal;
      renderPlan();
      renderGrocery();
    }
  } catch (_) {}
}

function showHistory() {
  const history = JSON.parse(localStorage.getItem('platepilot_history') || '[]');
  const list = $('#historyList');
  if (!history.length) {
    list.innerHTML = '<p class="hint">No saved plans yet. Generate one first.</p>';
  } else {
    list.innerHTML = history
      .map(
        (h, i) => `
      <div class="history-item">
        <div>
          <strong>₹${h.budget}/day · ${h.goal}</strong>
          <div class="hint">${new Date(h.ts).toLocaleString()} · ${h.kcal} kcal · ₹${h.cost}</div>
        </div>
        <button type="button" class="ghost small" data-idx="${i}">Load</button>
      </div>`
      )
      .join('');
    list.querySelectorAll('button[data-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.plan = history[Number(btn.dataset.idx)].snapshot;
        state.activeDay = 0;
        renderPlan();
        renderGrocery();
        $('#historyModal') && closeModal('historyModal');
      });
    });
  }
  openModal('historyModal');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
