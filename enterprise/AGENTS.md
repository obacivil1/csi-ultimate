<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:ux-design-system -->
# UX Design System

## Reusable Components

- **`EmptyState`** (`@/components/empty-states`): 6 SVG illustration variants — `search`, `data`, `sites`, `notifications`, `quality`, `general`. Props: `variant`, `title`, `description?`, `action?`, `className?`. Always use this instead of manual empty/error states.

- **`TrendBadge`** (`@/components/trend-badge`): Color-coded up/down/flat trend indicator. Props: `value` (number), `suffix?` (default "%"), `inverse?` (true if lower is better). Use on KPI cards for data storytelling.

- **`NotificationCenter`** (`@/components/notification-center`): SSE-connected real-time notification dropdown. Hook `useNotifications()` returns `{ unreadCount, markAllRead }`. Used in TopBar.

## Design Principles

1. **Every screen answers**: What happened? Why did it happen? What should I do next?
2. **Empty states must guide**: Never just "No data" — include description + CTA button.
3. **Data storytelling**: KPI cards must include trend context (TrendBadge).
4. **Notifications are real-time**: SSE-based, not polling.
5. **Consistent states**: Every page handles loading, empty, engine-offline, and populated states.
6. **SVG illustrations**: Empty states use inline SVG components, not external files.

## Color System

- Success: oklch(0.55 0.18 160) — emerald
- Warning: oklch(0.6 0.2 80) — amber
- Error: oklch(0.58 0.24 30) — rose
- Primary: custom theme color via CSS variables
- Text: foreground/muted-foreground hierarchy
<!-- END:ux-design-system -->
