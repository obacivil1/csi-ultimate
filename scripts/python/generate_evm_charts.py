import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import numpy as np
import os

OUT_DIR = r"E:\N8N\scraper\scraper2\csi-ultimate\evm_charts"
os.makedirs(OUT_DIR, exist_ok=True)

# Use Arial for maximum Unicode coverage (minus sign, Arabic chars, etc.)
plt.rcParams['font.family'] = 'sans-serif'
try:
    fm.findfont('Arial', fallback_to_default=False)
    plt.rcParams['font.sans-serif'] = ['Arial'] + plt.rcParams['font.sans-serif']
except:
    pass
plt.rcParams['font.size'] = 12

NAVY = '#1B2A4A'
TEAL = '#1A8A9E'
GOLD = '#C8962E'
RED = '#C0392B'
GREEN = '#27AE60'
GRAY = '#7F8C8D'
BLUE = '#2980B9'
LIGHT_BG = '#F4F6F9'

# ---- 1. S-CURVE ----
months = np.arange(1, 13)
pv = np.array([5, 12, 22, 35, 48, 60, 70, 78, 85, 91, 96, 100])
ev = np.array([4, 10, 19, 30, 42, 55, 66, 75, 83, 90, 95, 100])
ac = np.array([5, 14, 25, 38, 52, 65, 75, 82, 88, 93, 97, 100])

fig, ax = plt.subplots(figsize=(10, 5.5))
ax.fill_between(months, pv, alpha=0.08, color=NAVY)
ax.plot(months, pv, 'o-', color=NAVY, linewidth=2.5, markersize=6, label='PV (Planned Value)')
ax.plot(months, ev, 's-', color=GREEN, linewidth=2.5, markersize=6, label='EV (Earned Value)')
ax.plot(months, ac, 'd-', color=RED, linewidth=2.5, markersize=6, label='AC (Actual Cost)')

ax.annotate(f'PV={pv[7]}', xy=(months[7], pv[7]), xytext=(months[7]+0.3, pv[7]+5),
            fontsize=10, color=NAVY, fontweight='bold')
ax.annotate(f'EV={ev[7]}', xy=(months[7], ev[7]), xytext=(months[7]+0.3, ev[7]-8),
            fontsize=10, color=GREEN, fontweight='bold')
ax.annotate(f'AC={ac[7]}', xy=(months[7], ac[7]), xytext=(months[7]+0.3, ac[7]+5),
            fontsize=10, color=RED, fontweight='bold')

ax.set_xlabel('Months', fontsize=13, fontweight='bold')
ax.set_ylabel('Cumulative Cost (Million SAR)', fontsize=13, fontweight='bold')
ax.set_title('EVM S-Curve  |  PV / EV / AC', fontsize=16, fontweight='bold', pad=15)
ax.legend(loc='lower right', fontsize=11, framealpha=0.9)
ax.set_xlim(0, 13)
ax.set_ylim(0, 110)
ax.grid(True, alpha=0.3)
ax.set_facecolor(LIGHT_BG)
fig.patch.set_facecolor('white')
plt.tight_layout()
plt.savefig(os.path.join(OUT_DIR, '01_scurve.png'), dpi=200, bbox_inches='tight')
plt.close()
print("1/8 S-Curve done")

# ---- 2. CPI / SPI TREND ----
cpi = np.array([0.80, 0.71, 0.76, 0.79, 0.81, 0.85, 0.88, 0.91, 0.94, 0.97, 0.98, 1.00])
spi = np.array([0.80, 0.83, 0.86, 0.86, 0.88, 0.92, 0.94, 0.96, 0.98, 0.99, 0.99, 1.00])

fig, ax = plt.subplots(figsize=(10, 5))
ax.plot(months, cpi, 'o-', color=TEAL, linewidth=2.5, markersize=7, label='CPI (Cost Performance Index)')
ax.plot(months, spi, 's-', color=GOLD, linewidth=2.5, markersize=7, label='SPI (Schedule Performance Index)')
ax.axhline(y=1.0, color='#2C3E50', linewidth=1.5, linestyle='--', alpha=0.7, label='Target (1.0)')
ax.fill_between(months, 1.0, cpi, alpha=0.08, color=TEAL)
ax.fill_between(months, 1.0, spi, alpha=0.08, color=GOLD)

ax.annotate('CPI = 0.91', xy=(8, 0.91), xytext=(8.3, 0.86), fontsize=11, color=TEAL, fontweight='bold')
ax.annotate('SPI = 0.96', xy=(8, 0.96), xytext=(8.3, 0.99), fontsize=11, color=GOLD, fontweight='bold')

ax.set_xlabel('Months', fontsize=13, fontweight='bold')
ax.set_ylabel('Index Value', fontsize=13, fontweight='bold')
ax.set_title('CPI & SPI Trend Analysis  |  Monthly Performance', fontsize=16, fontweight='bold', pad=15)
ax.legend(loc='lower right', fontsize=11, framealpha=0.9)
ax.set_xlim(0, 13)
ax.set_ylim(0.6, 1.15)
ax.grid(True, alpha=0.3)
ax.set_facecolor(LIGHT_BG)
fig.patch.set_facecolor('white')
plt.tight_layout()
plt.savefig(os.path.join(OUT_DIR, '02_cpi_spi_trend.png'), dpi=200, bbox_inches='tight')
plt.close()
print("2/8 CPI/SPI done")

# ---- 3. CV & SV ----
cv = ev - ac
sv = ev - pv

fig, ax = plt.subplots(figsize=(10, 5))
x = np.arange(len(months))
width = 0.35
bars1 = ax.bar(x - width/2, cv, width, label='CV (Cost Variance)', color=TEAL, alpha=0.85)
bars2 = ax.bar(x + width/2, sv, width, label='SV (Schedule Variance)', color=GOLD, alpha=0.85)

for bar in bars1:
    h = bar.get_height()
    ax.annotate(f'{h:+.0f}', xy=(bar.get_x() + bar.get_width()/2, h),
                xytext=(0, 3 if h >= 0 else -12), textcoords='offset points', fontsize=7, ha='center', color=TEAL)
for bar in bars2:
    h = bar.get_height()
    ax.annotate(f'{h:+.0f}', xy=(bar.get_x() + bar.get_width()/2, h),
                xytext=(0, 3 if h >= 0 else -12), textcoords='offset points', fontsize=7, ha='center', color=GOLD)

ax.set_xlabel('Months', fontsize=13, fontweight='bold')
ax.set_ylabel('Variance (Million SAR)', fontsize=13, fontweight='bold')
ax.set_title('Cost & Schedule Variance  |  Monthly', fontsize=16, fontweight='bold', pad=15)
ax.set_xticks(x)
ax.set_xticklabels(months, fontsize=10)
ax.axhline(y=0, color='#2C3E50', linewidth=1)
ax.legend(loc='lower right', fontsize=11, framealpha=0.9)
ax.grid(True, axis='y', alpha=0.3)
ax.set_facecolor(LIGHT_BG)
fig.patch.set_facecolor('white')
plt.tight_layout()
plt.savefig(os.path.join(OUT_DIR, '03_cv_sv.png'), dpi=200, bbox_inches='tight')
plt.close()
print("3/8 CV/SV done")

# ---- 4. EAC FORECAST ----
eac_values = np.array([125, 141, 132, 127, 124, 118, 114, 110, 106, 103, 102, 100])
bac = 100

fig, ax = plt.subplots(figsize=(10, 5))
ax.plot(months, eac_values, 'o-', color=RED, linewidth=2.5, markersize=7, label='EAC (Estimate at Completion)')
ax.axhline(y=bac, color=GREEN, linewidth=2, linestyle='--', alpha=0.8, label=f'BAC = {bac} M SAR')
ax.fill_between(months, bac, eac_values, alpha=0.1, color=RED)

ax.annotate(f'EAC = {eac_values[-1]}', xy=(months[-1], eac_values[-1]),
            xytext=(months[-1]-1, eac_values[-1]+5), fontsize=12, color=RED, fontweight='bold')

ax.set_xlabel('Months', fontsize=13, fontweight='bold')
ax.set_ylabel('Million SAR', fontsize=13, fontweight='bold')
ax.set_title('Estimate at Completion (EAC) Forecast  |  Trending to BAC', fontsize=16, fontweight='bold', pad=15)
ax.legend(loc='upper right', fontsize=11, framealpha=0.9)
ax.set_xlim(0, 13)
ax.set_ylim(80, 150)
ax.grid(True, alpha=0.3)
ax.set_facecolor(LIGHT_BG)
fig.patch.set_facecolor('white')
plt.tight_layout()
plt.savefig(os.path.join(OUT_DIR, '04_eac_forecast.png'), dpi=200, bbox_inches='tight')
plt.close()
print("4/8 EAC done")

# ---- 5. PERFORMANCE DASHBOARD GAUGES ----
fig, axs = plt.subplots(1, 3, figsize=(12, 4.5), subplot_kw={'polar': True})

metrics = [
    ('CPI', 0.91, TEAL),
    ('SPI', 0.96, GOLD),
    ('TCPI', 1.08, RED),
]

for i, (label, val, color) in enumerate(metrics):
    ax = axs[i]
    ax.set_theta_direction(-1)
    ax.set_theta_offset(np.pi / 2)
    ax.set_ylim(0, 1.5)
    ax.set_xlim(0, np.pi)

    theta = np.linspace(0, np.pi, 100)
    ax.plot(theta, [1.5]*100, color='#E0E0E0', linewidth=1, alpha=0.3)
    ax.fill_between(theta, 0, 1.5, alpha=0.05, color='gray')

    angle = (val / 1.5) * np.pi
    ax.plot([0, angle], [0, 1.3], color=color, linewidth=3)
    ax.scatter(0, 0, s=80, color=color, zorder=5)

    ax.text(np.pi/2, 0.5, f'{val:.2f}', fontsize=22, fontweight='bold', ha='center', color=color)
    ax.text(np.pi/2, 0.2, f'{label}', fontsize=13, fontweight='bold', ha='center', color='#2C3E50')

    ax.set_xticks([])
    ax.set_yticks([])
    ax.spines['polar'].set_visible(False)
    ax.grid(False)

fig.suptitle('EVM Performance Dashboard  |  Current Period', fontsize=16, fontweight='bold', y=1.05)
plt.tight_layout()
plt.savefig(os.path.join(OUT_DIR, '05_dashboard_gauges.png'), dpi=200, bbox_inches='tight')
plt.close()
print("5/8 Dashboard gauges done")

# ---- 6. EAC / ETC / VAC COMPARISON ----
categories = ['BAC', 'EAC', 'ETC', 'VAC']
values = [100, 107, 7, -7]
colors_bar = [GREEN, RED, BLUE, RED]

fig, ax = plt.subplots(figsize=(8, 5))
bars = ax.bar(categories, values, color=colors_bar, alpha=0.8, edgecolor='white', linewidth=1.5, width=0.5)

for bar, val in zip(bars, values):
    y = bar.get_height()
    ax.annotate(f'{val:+,.0f} M SAR', xy=(bar.get_x() + bar.get_width()/2, y),
                xytext=(0, 8 if y >= 0 else -15), textcoords='offset points', fontsize=13,
                ha='center', fontweight='bold', color='#2C3E50')

ax.axhline(y=0, color='#2C3E50', linewidth=1)
ax.set_title('EAC / ETC / VAC  |  Project Forecast Summary', fontsize=16, fontweight='bold', pad=15)
ax.grid(True, axis='y', alpha=0.3)
ax.set_facecolor(LIGHT_BG)
fig.patch.set_facecolor('white')
plt.tight_layout()
plt.savefig(os.path.join(OUT_DIR, '06_eac_etc_vac.png'), dpi=200, bbox_inches='tight')
plt.close()
print("6/8 EAC/ETC/VAC done")

# ---- 7. COST BREAKDOWN PIE ----
labels_pie = ['Direct Labor', 'Materials', 'Equipment', 'Subcontractors', 'Overhead', 'Contingency']
sizes = [28, 25, 18, 15, 9, 5]
explode = (0.03, 0.03, 0.03, 0.03, 0.03, 0.05)

fig, ax = plt.subplots(figsize=(8, 6))
wedges, texts, autotexts = ax.pie(sizes, explode=explode, labels=labels_pie, autopct='%1.0f%%',
                                   colors=[NAVY, TEAL, GOLD, BLUE, GREEN, RED],
                                   shadow=False, startangle=140,
                                   textprops={'fontsize': 12, 'fontweight': 'bold', 'color': '#2C3E50'})
for at in autotexts:
    at.set_color('white')
    at.set_fontweight('bold')
ax.set_title('Construction Project Cost Breakdown Structure', fontsize=16, fontweight='bold', pad=20)
plt.tight_layout()
plt.savefig(os.path.join(OUT_DIR, '07_cost_breakdown.png'), dpi=200, bbox_inches='tight')
plt.close()
print("7/8 Cost breakdown done")

# ---- 8. VAC TREND ----
vac = np.array([-25, -41, -32, -27, -24, -18, -14, -10, -6, -3, -2, 0])

fig, ax = plt.subplots(figsize=(10, 5))
ax.fill_between(months, 0, vac, alpha=0.15, color=RED)
ax.plot(months, vac, 'o-', color=RED, linewidth=2.5, markersize=7, label='VAC (Variance at Completion)')
ax.axhline(y=0, color=GREEN, linewidth=2, linestyle='--', alpha=0.7)

ax.annotate(f'VAC = {vac[-1]:+d}', xy=(months[-1], vac[-1]),
            xytext=(months[-1]-2, vac[-1]+5), fontsize=13, color=RED, fontweight='bold')
ax.annotate(f'VAC = {vac[0]:+d}', xy=(months[0], vac[0]),
            xytext=(months[0]+0.5, vac[0]-6), fontsize=13, color=RED, fontweight='bold')

ax.set_xlabel('Months', fontsize=13, fontweight='bold')
ax.set_ylabel('Variance (Million SAR)', fontsize=13, fontweight='bold')
ax.set_title('Variance at Completion (VAC) Trend  |  Recovery Toward Target', fontsize=16, fontweight='bold', pad=15)
ax.legend(loc='lower right', fontsize=11, framealpha=0.9)
ax.set_xlim(0, 13)
ax.grid(True, alpha=0.3)
ax.set_facecolor(LIGHT_BG)
fig.patch.set_facecolor('white')
plt.tight_layout()
plt.savefig(os.path.join(OUT_DIR, '08_vac_trend.png'), dpi=200, bbox_inches='tight')
plt.close()
print("8/8 VAC trend done")

print(f"\nAll charts saved to: {OUT_DIR}")
print(f"Total files: {len(os.listdir(OUT_DIR))}")
