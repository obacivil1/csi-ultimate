import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
import os

OUT = r"E:\N8N\scraper\scraper2\csi-ultimate\consulting_charts"
os.makedirs(OUT, exist_ok=True)

plt.rcParams['font.family'] = 'sans-serif'
try:
    import matplotlib.font_manager as fm
    fm.findfont('Arial', fallback_to_default=False)
    plt.rcParams['font.sans-serif'] = ['Arial'] + plt.rcParams['font.sans-serif']
except:
    pass
plt.rcParams['font.size'] = 11

NAVY = '#1B2A4A'
TEAL = '#1A8A9E'
GOLD = '#C8962E'
RED = '#C0392B'
GREEN = '#27AE60'
ORANGE = '#E67E22'
DARK_RED = '#8E1B1B'
LIGHT_GRAY = '#E8ECF0'
MID_GRAY = '#95A5A6'

# ──────────────────────────────────────
# 1. WATERFALL CHART - Cost Overruns
# ──────────────────────────────────────
fig, ax = plt.subplots(figsize=(9, 5.5))
categories = ['Baseline\nBudget', 'Scope\nChanges', 'Material\nCost Esc.', 'Labor\nInefficiency', 'Design\nRework', 'Final\nCost']
values = [100, 8, 12, 6, 5, -3]
colors = [NAVY, RED, RED, RED, RED, GREEN]
bottom = 0

for i, (cat, val) in enumerate(zip(categories, values)):
    if i == 0:
        b = ax.bar(i, val, 0.5, color=NAVY, edgecolor='white', linewidth=0.5)
        ax.text(i, val/2, f'{val}', ha='center', va='center', fontweight='bold', fontsize=13, color='white')
        bottom = val
    elif i < len(categories) - 1:
        b = ax.bar(i, val, 0.5, bottom=bottom, color=RED, edgecolor='white', linewidth=0.5)
        ax.text(i, bottom + val/2, f'+{val}', ha='center', va='center', fontweight='bold', fontsize=11, color='white')
        bottom += val
    else:
        b = ax.bar(i, val, 0.5, bottom=bottom, color=GREEN, edgecolor='white', linewidth=0.5)
        ax.text(i, bottom + val/2, f'{val}', ha='center', va='center', fontweight='bold', fontsize=11, color='white')

ax.plot([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5], 
        [0, 100, 100, 108, 108, 120, 120, 126, 126, 131, 128],
        color='#2C3E50', linewidth=2, linestyle='--', alpha=0.5)

ax.set_xticks(range(6))
ax.set_xticklabels(categories, fontsize=9, fontweight='bold')
ax.set_ylabel('Million SAR', fontsize=12, fontweight='bold')
ax.set_title('Cost Overrun Waterfall  |  28% Budget Escalation', fontsize=14, fontweight='bold', pad=12, color=NAVY)
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'{x:.0f}'))
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.grid(True, axis='y', alpha=0.3)
ax.set_facecolor('#FAFBFC')
fig.patch.set_facecolor('white')
plt.tight_layout()
plt.savefig(os.path.join(OUT, 'waterfall_cost.png'), dpi=200, bbox_inches='tight')
plt.close()
print("1/5 Waterfall done")

# ──────────────────────────────────────
# 2. HEAT MAP - Risk Matrix
# ──────────────────────────────────────
fig, ax = plt.subplots(figsize=(9, 6))
impact_labels = ['Negligible', 'Minor', 'Moderate', 'Major', 'Critical']
prob_labels = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost Certain']

data = np.array([
    [1, 2, 3, 4, 5],
    [2, 3, 4, 5, 6],
    [3, 4, 5, 6, 7],
    [4, 5, 6, 7, 8],
    [5, 6, 7, 8, 9],
])

cmap_colors = ['#27AE60', '#2ECC71', '#F1C40F', '#E67E22', '#C0392B']
from matplotlib.colors import ListedColormap, BoundaryNorm
cmap_custom = ListedColormap(cmap_colors)
bounds = [0, 2, 4, 6, 8, 10]
norm = BoundaryNorm(bounds, cmap_custom.N)

im = ax.imshow(data, cmap=cmap_custom, norm=norm, aspect='auto')

# Annotate each cell
risk_texts = [['Low', 'Low', 'Med', 'Med', 'High'],
              ['Low', 'Med', 'Med', 'High', 'High'],
              ['Med', 'Med', 'High', 'High', 'Crit'],
              ['Med', 'High', 'High', 'Crit', 'Crit'],
              ['High', 'High', 'Crit', 'Crit', 'Crit']]
for i in range(5):
    for j in range(5):
        ax.text(j, i, f'{data[i,j]}\n{risk_texts[i][j]}', ha='center', va='center', fontsize=11,
                fontweight='bold', color='white' if data[i,j] >= 5 else '#2C3E50')

ax.set_xticks(range(5))
ax.set_yticks(range(5))
ax.set_xticklabels(prob_labels, fontsize=10)
ax.set_yticklabels(impact_labels, fontsize=10)
ax.set_xlabel('Probability', fontsize=12, fontweight='bold')
ax.set_ylabel('Impact', fontsize=12, fontweight='bold')
ax.set_title('Executive Risk Heat Map  |  Construction Project Exposure', fontsize=14, fontweight='bold', pad=12, color=NAVY)
fig.tight_layout()
plt.savefig(os.path.join(OUT, 'heatmap_risk.png'), dpi=200, bbox_inches='tight')
plt.close()
print("2/5 Heat map done")

# ──────────────────────────────────────
# 3. EXECUTIVE FAKE DASHBOARD
# ──────────────────────────────────────
fig, axs = plt.subplots(2, 4, figsize=(12, 5.5), subplot_kw={'polar': True})
axs = axs.flatten()

# Fake green dashboard indicators
dash_items = [
    ('Schedule', 'On Track', '▲ 2% ahead', GREEN),
    ('Budget', 'Within', '▼ 1% used', GREEN),
    ('Quality', 'Passed', '98% score', GREEN),
    ('Safety', 'Compliant', '0 incidents', GREEN),
    ('Resources', 'Adequate', '92% util.', GREEN),
    ('Risks', 'Monitored', '12 open', GOLD),
    ('Changes', 'Managed', '5 approved', GREEN),
    ('Milestones', '6 of 8', '75% done', GREEN),
]
kpi_vals = [78, 92, 98, 100, 92, 65, 85, 75]

for i, (title, status, sub, color) in enumerate(dash_items):
    ax = axs[i]
    # Gauge-like semicircle
    theta = np.linspace(0, np.pi, 100)
    ax.fill_between(theta, 0, 1, alpha=0.08, color='gray')
    ax.plot(theta, np.ones_like(theta), color='#E0E0E0', linewidth=2)
    val_angle = (kpi_vals[i] / 100) * np.pi
    ax.plot([0, val_angle], [0, 0.85], color=color, linewidth=3)
    ax.scatter(0, 0, s=60, color=color, zorder=5)
    ax.text(np.pi/2, 0.45, f'{kpi_vals[i]}%', fontsize=16, fontweight='bold', ha='center', color=color)
    ax.text(np.pi/2, 0.2, status, fontsize=9, ha='center', color=color, fontweight='bold')
    ax.text(np.pi/2, -0.15, sub, fontsize=7, ha='center', color=MID_GRAY)
    ax.set_xlim(0, np.pi)
    ax.set_ylim(-0.3, 1.1)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.spines['polar'].set_visible(False)
    ax.grid(False)
    ax.set_title(title, fontsize=9, fontweight='bold', color=NAVY, pad=5)

fig.suptitle('Executive Dashboard  |  Project Status Overview', fontsize=15, fontweight='bold', y=1.02, color=NAVY)
plt.tight_layout()
plt.savefig(os.path.join(OUT, 'fake_dashboard.png'), dpi=200, bbox_inches='tight')
plt.close()
print("3/5 Fake dashboard done")

# ──────────────────────────────────────
# 4. CASE STUDY KPI CARDS
# ──────────────────────────────────────
fig, ax = plt.subplots(figsize=(10, 5.5))
ax.set_xlim(0, 10)
ax.set_ylim(0, 6)
ax.axis('off')

# Title
ax.text(5, 5.6, 'Mega Airport Terminal  |  Performance Summary', fontsize=15, fontweight='bold', ha='center', color=NAVY)
ax.text(5, 5.3, 'SAR 2.5 Billion  |  48 Months Planned', fontsize=11, ha='center', color=MID_GRAY)

# KPI cards
kpis = [
    (1.0, 3.5, 'Original\nBudget', '2.50 B', 'SAR', GREEN, 'SAR 2.50B'),
    (3.5, 3.5, 'Actual\nCost', '3.45 B', 'SAR', RED, 'SAR 3.45B'),
    (6.0, 3.5, 'Original\nDuration', '48 mo', 'Months', GREEN, '48 Months'),
    (8.5, 3.5, 'Actual\nDuration', '68 mo', 'Months', RED, '68 Months'),
]

for x, y, title, val, unit, color, detail in kpis:
    rect = mpatches.FancyBboxPatch((x, y), 1.8, 1.5, boxstyle="round,pad=0.1",
                                     facecolor='white', edgecolor=color, linewidth=2.5)
    ax.add_patch(rect)
    ax.text(x + 0.9, y + 0.2, title, fontsize=8, ha='center', va='center', color=MID_GRAY)
    ax.text(x + 0.9, y + 0.7, val, fontsize=22, fontweight='bold', ha='center', color=color)
    ax.text(x + 0.9, y + 1.05, unit, fontsize=9, ha='center', color=MID_GRAY)

# Delta cards
deltas = [
    (1.0, 1.0, 'Cost Overrun', '+38%', RED, 'SAR 950M over budget'),
    (6.0, 1.0, 'Schedule Delay', '+42%', RED, '20 months behind plan'),
]
for x, y, title, val, color, desc in deltas:
    rect = mpatches.FancyBboxPatch((x, y), 3.5, 1.3, boxstyle="round,pad=0.1",
                                     facecolor=color, edgecolor=color, linewidth=2)
    ax.add_patch(rect)
    ax.text(x + 1.75, y + 0.1, title, fontsize=9, ha='center', color='white', fontweight='bold')
    ax.text(x + 1.75, y + 0.5, val, fontsize=26, fontweight='bold', ha='center', color='white')
    ax.text(x + 1.75, y + 0.9, desc, fontsize=9, ha='center', color='#FFD0D0')

plt.tight_layout()
plt.savefig(os.path.join(OUT, 'case_study_kpi.png'), dpi=200, bbox_inches='tight')
plt.close()
print("4/5 Case study KPI done")

# ──────────────────────────────────────
# 5. PMO DASHBOARD (SPI/CPI/Forecasts)
# ──────────────────────────────────────
fig = plt.figure(figsize=(12, 6))
gs = fig.add_gridspec(2, 3, hspace=0.3, wspace=0.3)

# SPI chart
ax1 = fig.add_subplot(gs[0, 0])
months = np.arange(1, 13)
spi = np.array([0.85, 0.82, 0.84, 0.86, 0.88, 0.90, 0.91, 0.93, 0.94, 0.96, 0.98, 0.99])
ax1.plot(months, spi, 'o-', color=GOLD, linewidth=2.5, markersize=6)
ax1.axhline(y=1.0, color=RED, linestyle='--', alpha=0.5)
ax1.fill_between(months, 0.8, spi, alpha=0.1, color=GOLD)
ax1.set_ylim(0.75, 1.05)
ax1.set_title('SPI Trend', fontsize=11, fontweight='bold', color=NAVY)
ax1.grid(True, alpha=0.3)
ax1.set_facecolor('#FAFBFC')

# CPI chart
ax2 = fig.add_subplot(gs[0, 1])
cpi = np.array([0.78, 0.75, 0.79, 0.82, 0.84, 0.86, 0.88, 0.90, 0.92, 0.94, 0.96, 0.97])
ax2.plot(months, cpi, 's-', color=TEAL, linewidth=2.5, markersize=6)
ax2.axhline(y=1.0, color=RED, linestyle='--', alpha=0.5)
ax2.fill_between(months, 0.7, cpi, alpha=0.1, color=TEAL)
ax2.set_ylim(0.7, 1.05)
ax2.set_title('CPI Trend', fontsize=11, fontweight='bold', color=NAVY)
ax2.grid(True, alpha=0.3)
ax2.set_facecolor('#FAFBFC')

# EAC Forecast
ax3 = fig.add_subplot(gs[0, 2])
eac = np.array([320, 333, 316, 305, 298, 291, 284, 278, 272, 266, 261, 258])
bac = 250
ax3.plot(months, eac, 'd-', color=RED, linewidth=2.5, markersize=6)
ax3.axhline(y=bac, color=GREEN, linestyle='--', alpha=0.6, label=f'BAC {bac}M')
ax3.fill_between(months, bac, eac, alpha=0.1, color=RED)
ax3.set_title('EAC Forecast (Million SAR)', fontsize=11, fontweight='bold', color=NAVY)
ax3.grid(True, alpha=0.3)
ax3.set_facecolor('#FAFBFC')

# Risk Score
ax4 = fig.add_subplot(gs[1, 0])
risk_scores = np.array([8.5, 8.2, 7.8, 7.5, 7.0, 6.8, 6.5, 6.2, 5.8, 5.5, 5.2, 4.8])
ax4.fill_between(months, 0, risk_scores, alpha=0.2, color=RED)
ax4.plot(months, risk_scores, 'o-', color=RED, linewidth=2.5, markersize=6)
ax4.axhline(y=5, color=GREEN, linestyle='--', alpha=0.5)
ax4.axhline(y=7, color=GOLD, linestyle='--', alpha=0.5)
ax4.set_ylim(0, 10)
ax4.set_title('Risk Score /10', fontsize=11, fontweight='bold', color=NAVY)
ax4.grid(True, alpha=0.3)
ax4.set_facecolor('#FAFBFC')

# Budget Burn Rate
ax5 = fig.add_subplot(gs[1, 1])
burn = np.array([18, 22, 25, 28, 30, 32, 33, 34, 35, 36, 36, 37])
planned_burn = np.array([20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42])
ax5.plot(months, burn, 'o-', color=RED, linewidth=2, label='Actual')
ax5.plot(months, planned_burn, '--', color=GREEN, linewidth=2, label='Planned')
ax5.set_title('Budget Burn Rate (M/M)', fontsize=11, fontweight='bold', color=NAVY)
ax5.grid(True, alpha=0.3)
ax5.legend(fontsize=8)
ax5.set_facecolor('#FAFBFC')

# VAC
ax6 = fig.add_subplot(gs[1, 2])
vac = np.array([-70, -83, -66, -55, -48, -41, -34, -28, -22, -16, -11, -8])
ax6.fill_between(months, 0, vac, alpha=0.15, color=RED)
ax6.plot(months, vac, 'o-', color=RED, linewidth=2.5, markersize=6)
ax6.axhline(y=0, color=GREEN, linestyle='--', alpha=0.6)
ax6.set_title('VAC (Million SAR)', fontsize=11, fontweight='bold', color=NAVY)
ax6.grid(True, alpha=0.3)
ax6.set_facecolor('#FAFBFC')

fig.suptitle('PMO Performance Monitoring Dashboard', fontsize=14, fontweight='bold', y=1.02, color=NAVY)
plt.tight_layout()
plt.savefig(os.path.join(OUT, 'pmo_dashboard.png'), dpi=200, bbox_inches='tight')
plt.close()
print("5/5 PMO dashboard done")

print(f"\nAll consulting charts saved to {OUT}")
