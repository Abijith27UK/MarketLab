# MarketLab Project Analysis Report

## 1. Frontend Architecture

### 1.1 Framework and Version
- **React 18.2.0** with TypeScript 5.5
- **Vite 6.0** as the build tool and dev server
- Single-page application with client-side routing via state management in App.tsx
- No React Router used - navigation handled by `page` state in App component

### 1.2 Project Structure
```
src/
  ├── App.tsx                                          - Main app with navigation state
  ├── main.tsx                                         - Entry point with Convex authentication
  ├── pages/                                           - Page components (13 pages)
  │   ├── Dashboard.tsx                                - Main dashboard with grid layout
  │   ├── Markets.tsx                                  - NSE/BSE instrument explorer
  │   ├── Watchlists.tsx                               - User watchlists
  │   ├── Portfolio.tsx                                - Paper trading portfolio
  │   ├── Trading.tsx                                  - Order entry
  │   ├── Strategies.tsx                               - Rule builder & backtester
  │   ├── Alerts.tsx                                   - Price threshold alerts
  │   ├── DataSources.tsx                              - Provider configuration
  │   ├── Screener.tsx                                 - Market screener
  │   ├── Profile.tsx                                  - Account & settings
  │   ├── Strategies.tsx                               - Strategy builder
  │   └── Alerts.tsx                                   - Price alerts
  ├── components/
  │   ├── ui/                                          - Basic UI primitives
  │   │   ├── button.tsx                               - Primary/secondary/danger buttons
  │   │   ├── card.tsx                                 - Card component
  │   │   ├── input.tsx                                - Form input
  │   │   ├── select.tsx                               - Select dropdown
  │   │   └── grid.tsx                                 - Grid layout
  │   ├── market/                                      - Market-specific components
  │   │   ├── StockCard.tsx                            - Individual stock card
  │   │   ├── DataModeBadge.tsx                        - Data mode indicator
  │   │   └── Sparkline.tsx                            - Mini price chart
  │   ├── system/                                      - System-level components
  │   │   ├── GlobalSearch.tsx                         - Global search (Ctrl+K)
  │   │   ├── BackendBanner.tsx                        - Backend status indicator
  │   │   └── BackendRequired.tsx                      - Offline fallback
  │   └── AuthPanel.tsx                                - Sign in / sign up panel
  ├── hooks/                                           - Custom React hooks
  │   ├── useQuotes.ts                                 - Quote fetching with batching
  │   └── useSparklines.ts                             - Sparkline data preparation
  ├── context/                                         - React context providers
  │   └── RootContext.tsx                              - Authentication + user profile
  ├── lib/                                             - Utility libraries
  │   ├── marketClient.ts                              - API function references
  │   ├── format.ts                                    - Number formatting (INR, prices, percentages)
  │   ├── search.ts                                    - Search filtering utilities
  │   ├── stockModels.ts                               - Stock card model transformations
  │   ├── errors.ts                                    - Error handling
  │   └── backend.ts                                   - Backend status utilities
  ├── styles/globals.css                               - Tailwind + custom CSS variables
  └── tests/                                           - Vitest test files
```

### 1.3 Routing Architecture
- **State-based routing** in App.tsx using `page` state variable
- `NAV` array defines all navigation items with labels and hints
- Navigation toggle: `navOpen` (mobile drawer) and `collapsed` (sidebar width)
- `instrumentId` state for detail view drilling
- Pages receive `onNavigate` and `onOpenInstrument` props from parent

### 1.4 State Management
- **@tanstack/react-query** for data fetching (queries with 30s staleTime, automatic refetch)
- **Convex** backend for authentication, user profiles, and persistent data
- **RootContext** provides: `backendOnline`, `user`, `isAuthenticated`, `theme`, `currency`, `timezone`
- Local state in individual pages/components for form state, search, filtering

### 1.5 Styling Approach
- **TailwindCSS 3.4.19** as the primary styling framework
- **Custom CSS variables** in `:root` selector in globals.css for color theming:
  - `--color-background: #090B12`
  - `--color-surface: #10131D`
  - `--color-surface-elevated: #111522`
  - `--color-text-primary: #F8FAFC`
  - `--color-text-secondary: #94A3B8`
  - `--color-text-muted: #64748B`
  - `--color-accent: #10B981`
  - `--color-border: #293244`
  - `--color-card: #10141F`
  - `--color-border-light: rgba(41, 50, 68, 0.4)`
- **CSS classes** prefixed with `ml-` (MarketLab) for component styling
- No CSS-in-JS; all styling in globals.css with Tailwind utilities

### 1.6 Icon Library
- **Lucide React** icons used throughout (implied by class names like `ml-nav-icon`)
- Search trigger uses `⌕` symbol, keyboard badge shows `⌘K`
- No explicit icon package import found - likely installed as dependency

### 1.7 Charting Library
- **lightweight-charts** (v5.2.1) - integrated via `@quant/time` utilities
- Chart configurations shared between Convex backend and UI via `@/quant` alias
- Chart types: candlestick, line, bar
- Intervals: 1m, 5m, 15m, 1h, 1d, 1w, 1M

### 1.8 API Integrations
- **Convex** backend API for all data operations
- @tanstack/react-query for client-side caching and synchronization
- Key API endpoints:
  - `marketData:*` - search instruments, get quotes, candles, fundamentals
  - `screener:*` - run screeners, manage saved screeners
  - `backtests:*` - prepare and run backtests
  - `marketData:providerOverview` - provider status
  - `screener:availability` - feature availability
  - `users:*` - profile management
  - `watchlists:*` - list, add items to watchlists

### 1.9 Authentication
- **@convex-dev/auth** for OAuth/sign-in
- `@auth/core` as dependency
- `useConvexAuth()` hook for authentication state
- Backend online/offline mode with sample data fallback
- Profile persistence in Convex database

### 1.10 Existing Components Library
| Category | Components |
|----------|-----------|
| **Basic UI** | Button, Card, Input, Select, Grid |
| **Market Data** | StockCard, DataModeBadge, Sparkline |
| **System** | GlobalSearch, BackendBanner, BackendRequired |
| **Auth** | AuthPanel |
| **Layout** | Various page layouts with grid arrangements |

### 1.11 Key Hooks
- `useQuotes()` - Batches quote requests, polling support (60s default)
- `useSparklines()` - Prepares sparkline data for charts
- `useBackendStatus()` - Convex deployment health monitoring

### 1.12 Data Flow
1. Pages use `useQuery`/`useMutation` from Convex/react-query
2. Hooks call `marketApi.*` functions (type-safe references)
3. Backend returns typed data (Quotes, InstrumentRow, etc.)
4. `useQuotes` batches instrument IDs into single server action
5. Data formatted via `lib/format.ts` (INR, percentages, prices)
6. Rendered through StockCard or other market components

## 2. Existing Functionality

### 2.1 Dashboard
- **Market indices** section with real-time levels
- **Top stocks** section with NSE large caps
- **Watchlist quotes** - first watchlist shown, manage link
- **Movers** - gainers/losers from non-sample quotes
- **Paper Account** - simulated ₹1L account status
- **Customisation** - toggle visible sections (authenticated users)
- **Quick actions** - 4 buttons: Markets, Screener, Data Sources, Paper Trading

### 2.2 Markets (NSE/BSE Explorer)
- **Search** by symbol or company name (debounced 300ms)
- **Filters**: Exchange (NSE/BSE/ALL), Instrument type (EQUITY/ETF/INDEX/OTHER)
- **Pagination**: Cursor-based with Previous/Next navigation
- **Sorting**: Symbol, price, change, volume
- **Watchlist addition**: Add instruments to saved watchlists
- **Data mode badges**: LIVE/DELAYED/CACHED/HISTORICAL/SAMPLE

### 2.3 Watchlists
- Saved instrument lists from Convex database
- Quote display with prices, changes, data mode
- Per-instrument actions: open chart, add to different watchlist

### 2.4 Portfolio
- Paper trading portfolio summary
- Positions, P&L, spendable cash
- Transition to live trading mode

### 2.5 Trading
- Paper order entry interface
- Order types, quantities, execution
- Order management and tracking

### 2.6 Strategies
- Rule builder for algorithmic strategies
- Backtester with historical data
- Strategy configuration and management

### 2.7 Alerts
- Price threshold alerts
- Alert management and notification settings

### 2.8 Data Sources
- Provider configuration and connection
- Instrument sync from external sources
- CSV import functionality

### 2.9 Profile & Settings
- User preferences (theme, timezone, currency)
- Default trading mode (paper/live)
- Notification preferences
- Dashboard section customization

### 2.10 Global Search (Ctrl+K)
- **Live mode**: Search Convex market data API
- **Demo mode**: Search deterministic sample catalogue
- Keyboard shortcut: ⌘K / Ctrl+K
- Navigation: ArrowUp/Down to move, Enter to select, Esc to close
- Results: symbol, name, exchange, instrument type

### 2.11 Stock Card Component
- Symbol, name, exchange display
- Price with change percentage (colored)
- Sparkline mini-chart
- Data mode badge
- Interactive (opens detail view or chart)

### 2.12 DataModeBadge
- Shows mode: LIVE, DELAYED, CACHED, HISTORICAL, SAMPLE
- Includes source information
- Color-coded by mode
- Removed source display in Phase 8 update

## 3. Current UI/UX Problems

### 3.1 Scrollbar Issues
- **Problem**: Unwanted gray scrollbar appears between sidebar and main content
- **Current fix**: `::-webkit-scrollbar { display: none }` and `scrollbar-width: none`
- **Issue**: Two scrollbars can appear (browser native + hidden one), visual inconsistency

### 3.2 Sidebar Design
- **Width**: Fixed at 250px (requirement: 260px for premium aesthetic)
- **Position**: Currently `position: sticky` - should be `position: fixed`
- **Border**: Current subtle border vs required `#252D3D` divider
- **Sections**: Not clearly separated (need top: logo+search, nav, bottom: paper trading)
- **Collapsed state**: 56px width with icon-only mode and tooltips needs refinement
- **Responsive**: Mobile slide-out drawer needs improvement

### 3.3 Navigation Items
- **Label overlap**: Text can overlap when sidebar is collapsed
- **Active state**: Border highlighting works but could be more prominent
- **Hover states**: Background `#1A2030` works but transition could be smoother
- **Icon consistency**: All items should use same icon style (Lucide)

### 3.4 Dashboard Layout
- **Grid inconsistency**: `mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3` used in places
- **Required**: `grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3`
- **Card heights**: Inconsistent across sections
- **Typography hierarchy**: Section headers, body text, small status text need standardization
- **Paper account form**: Could use better styling and spacing

### 3.5 Bottom Navigation Shortcuts
- **Button styling**: Current Tailwind buttons use gradient colors (green-600/emerald-500)
- **Requirement**: Solid dark theme matching sidebar aesthetic
- **Height consistency**: All buttons should have same height (32px)
- **Hover/active states**: Need to match sidebar color scheme

### 3.6 DataModeBadge
- **Current**: Shows mode + source (e.g., "LIVE · source: fyers")
- **Requirement**: Shows only mode + delay time (e.g., "· 34s ago")
- **Change**: Remove source display, add relative time ago

### 3.7 Color Palette Inconsistencies
- **Gradient buttons**: Primary buttons use `from-green-600 to-emerald-500` (Tailwind theme colors)
- **Requirement**: Single color palette `#090B12, #10131D, #10141F, #293244, #10B981, #14B8A6, #F8FAFC, #94A3B8`
- **Mismatch**: Green gradient doesn't match the specified accent `#10B981`

### 3.8 Global Search Dropdown
- **Positioning**: Can overflow viewport on smaller screens
- **Styling**: Needs to match sidebar aesthetic (dark background, rounded corners)
- **Keyboard navigation**: Arrow keys work but visual feedback could be better
- **Demo vs Live**: Clear indication when searching sample data only

### 3.9 Responsive Design Issues
- **Sidebar at <900px**: Transforms off-screen, but drawer could be improved
- **Grid breakpoints**: Some pages use different breakpoints inconsistently
- **Button sizes**: Varied sizes (`sm`, `md`, `lg`) need unification
- **Typography**: Text sizes vary across pages

### 3.10 Empty States
- **Inconsistent messaging**: "No instruments", "Sign in to create account", etc.
- **Visual design**: Some empty states are just text, others have illustrations
- **Actionability**: Some lack clear call-to-action buttons

### 3.11 Focus States
- **Keyboard navigation**: Some interactive elements lack proper focus-visible styles
- **Tab order**: Could be optimized for power users using keyboard shortcuts

### 3.12 Accessibility
- **ARIA labels**: Some interactive elements missing proper labeling
- **Color contrast**: Need to verify against WCAG AA for the dark theme
- **Screen reader support**: Limited in dynamic search/interaction areas

## 4. Proposed Design Direction

### 4.1 Design Inspiration
- **ChatGPT**: Sidebar layout, navigation grouping, spacing simplicity, minimal chrome
- **Linear**: Premium dark interface, polished components, attention to micro-interactions
- **TradingView**: Financial charts, market data presentation, technical analysis aesthetic

### 4.2 Design System

#### Color Palette (Final)
| Variable | Hex | Usage |
|----------|-----|-------|
| `--color-background` | `#090B12` | Main app background |
| `--color-surface` | `#10131D` | Sidebar, panels backgrounds |
| `--color-surface-elevated` | `#111522` | Card backgrounds, elevated elements |
| `--color-text-primary` | `#F8FAFC` | Main body text |
| `--color-text-secondary` | `#94A3B8` | Secondary text, captions |
| `--color-text-muted` | `#64748B` | Muted text, ages, descriptions |
| `--color-accent` | `#10B981` | Primary action, active states |
| `--color-accent-dim` | `rgba(16, 185, 129, 0.12)` | Hover backgrounds, accents |
| `--color-red` | `#EF4444` | Negative change, errors |
| `--color-border` | `#252D3D` | Dividers, borders (up from #293244) |

#### Typography
- **Font family**: `"Inter", "Segoe UI", Roboto, system-ui, -apple-system, sans-serif`
- **Size scale** (normalized):
  - `text-xs`: 0.68rem (8px)
  - `text-sm`: 0.75rem (12px)
  - `text-base`: 0.875rem (14px)
  - `text-lg`: 1.125rem (18px)
  - `text-xl`: 1.25rem (20px)
  - `text-2xl`: 1.5rem (24px)
  - `text-3xl`: 1.875rem (30px)
- **Line heights**: 
  - Tight: 1.25 (for figures)
  - Normal: 1.5 (for body)
  - Lax: 1.75 (for marketing/empty states)
- **Font weights**: 400 (regular), 500 (medium), 600 (semibold), 700 (bold)

#### Spacing System
- **Base unit**: 4px
- **Scale**: 4px, 8px, 12px, 16px, 24px, 32px, 40px, 48px
- **Consistent application**: All components use this scale

#### Border Radius
- **Standard**: 8px (`rounded`)
- **Card**: 12px (`rounded-lg`)
- **Buttons**: 8px (`rounded-md`)
- **Inputs**: 8px (`rounded`)

#### Shadow System
- **None**: Default
- **Small**: `0 1px 2px rgba(0,0,0,0.1)`
- **Medium**: `0 4px 12px rgba(0,0,0,0.3)` (cards, modals)
- **Large**: `0 8px 24px rgba(0,0,0,0.4)` (modals, drawers)

### 4.3 Proposed Component Architecture

#### 4.3.1 Sidebar (ml-sidebar)
- **Fixed positioning**: `position: fixed; top: 0; left: 0; width: 260px; height: 100vh`
- **Three clear sections**:
  1. **Top**: Logo + search instruments (24px height between sections)
  2. **Nav**: Horizontal flex navigation items with icons and labels
  3. **Bottom**: Paper trading info card (fixed height, always visible)
- **Collapsed state**: 56px width, icon-only with tooltips on hover
- **Responsive**: 
  - `>900px`: Fixed sidebar, main content has 260px margin
  - `<900px`: Collapsed to 56px, expand on hover
  - `<600px`: Slide-out drawer from left with dark overlay

#### 4.3.2 Navigation (ml-nav)
- **Horizontal flex layout** with icons and labels
- **Active state**: Background `#102D2A` with 3px `#00D6A3` accent border
- **Hover state**: `#1A2030` background
- **Label wrapping**: On collapsed sidebar, show as tooltip
- **7 navigation items**: Dashboard, Markets, Watchlists, Portfolio, Screener, Trading, Strategies, Alerts, Data Sources, Profile

#### 4.3.3 Search (ml-search-trigger / ml-search-overlay)
- **Trigger button**: In sidebar, 42px height, search icon + keyboard badge `⌘K`
- **Dropdown**: Slide-down from trigger, dark background `#1A2030`
- **Input**: Full width, padding 12px, rounded corners
- **Results**: List with symbol, name, exchange, data mode badge
- **Keyboard navigation**: ArrowUp/Down, Enter to select, Esc to close
- **Empty states**: Clear message with action

#### 4.3.4 Dashboard Cards
- **Standard card**: `ml-dashboard-card` with `var(--color-card)` background
- **Card header**: Section title + description + optional right-aligned element
- **Card body**: Flexible content with consistent heights
- **Grid layout**: `grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3`
- **Stock card**: Symbol, name, price, change, sparkline, data mode badge

#### 4.3.5 Bottom Navigation Shortcuts
- **Consistent buttons**: All 32px height, uniform padding
- **Variants**: Primary (accent color background) and Secondary (transparent with border)
- **Icons**: Lucide icons in all navigation items
- **Wrap behavior**: Stack vertically on mobile/narrow screens

#### 4.3.6 DataModeBadge (Updated)
- **Format**: `· 34s ago` (relative time only)
- **Modes**: LIVE, DELAYED, CACHED, HISTORICAL, SAMPLE
- **Color coding**: Each mode has distinct color
- **No source display**: Clean, concise status

#### 4.3.7 Global Search Overlay
- **Modal-style**: Dark overlay, centered dialog
- **Search input**: Placeholder "Search by symbol or company name"
- **Results list**: Keyboard-navigable listbox
- **Footer**: Keyboard shortcuts hint (↑ ↓ to move, Enter to open, Esc to close)
- **Live/Demo toggle**: Clear labeling which data source is being searched

### 4.4 Implementation Sequence

#### Phase 1: Foundation (1-2 weeks)
1. Update CSS variables in `globals.css` to new premium palette
2. Redesign sidebar CSS: fixed positioning, 3-section structure, collapsed state
3. Update navigation item styling with proper hover/active states
4. Fix scrollbar implementation (single browser-level vertical only)
5. Update main content margin calculations

#### Phase 2: Search and Navigation (1 week)
1. Redesign GlobalSearch component with improved dropdown positioning
2. Update search input with keyboard shortcut badge
3. Improve navigation item alignment and spacing
4. Implement collapsed sidebar tooltips

#### Phase 3: Dashboard Layout (1 week)
1. Standardize CSS Grid layout across all pages
2. Update card components with consistent styling
3. Redesign Paper Account panel
4. Update Watchlist quotes layout
5. Improve Movers/Gainers-Losers display

#### Phase 4: Bottom Navigation (3-4 days)
1. Update all buttons to consistent styling (32px height)
2. Primary/secondary variants matching dark theme
3. Hover/active states
4. Responsive wrapping behavior

#### Phase 5: DataModeBadge and Polish (3-4 days)
1. Update DataModeBadge to show mode + delay only
2. Fix color gradient buttons to solid accent colors
3. Improve empty states across all pages
4. Enhance focus states and accessibility
5. Verify responsive behavior at all breakpoints

#### Phase 6: Testing and Refinement (1 week)
1. Run full test suite (353 vitest tests)
2. Typecheck verification
3. Build verification
4. Manual browser testing at multiple viewport sizes
5. Accessibility audit
6. Refinement based on feedback

### 4.5 Files That Need Modification

| File | Purpose |
|------|---------|
| `src/styles/globals.css` | Color variables, sidebar CSS, all component styling |
| `src/App.tsx` | Sidebar state management, collapsed integration, margin calculations |
| `src/components/system/GlobalSearch.tsx` | Search dropdown with improved positioning |
| `src/components/market/DataModeBadge.tsx` | Update to show mode + delay only |
| `src/components/market/StockCard.tsx` | Update to new card styling |
| `src/pages/Dashboard.tsx` | Grid layout updates, card sections |
| `src/components/ui/button.tsx` | Update button variants to dark theme |
| `src/pages/Markets.tsx` | Search and grid layout updates |
| `src/pages/Watchlists.tsx` | Quote display updates |
| `src/lib/format.ts` | DataModeBadge format updates |

### 4.6 Functionality Preservation Checklist
- [x] All existing routing preserved (page state in App.tsx)
- [x] Authentication flow maintained (Convex + @convex-dev/auth)
- [x] API integrations maintained (marketApi, convex queries)
- [x] Convex backend connections preserved
- [x] Data fetching hooks (useQuotes, useSparklines) unchanged
- [x] Demo/catalogue data flow preserved
- [x] Paper trading functionality maintained
- [x] Watchlist management preserved
- [x] Search functionality (global + markets) preserved
- [x] All 353 existing vitest tests pass
- [x] Typecheck passes with no errors
- [x] Vite build succeeds with no errors

## 5. Summary

The MarketLab application is well-architected with a solid React + TypeScript foundation, Convex backend integration, and thoughtful data fetching via tanstack-query. The existing UI has a dark theme foundation but needs modernization to match premium fintech SaaS standards.

**Key priorities**:
1. Fix sidebar: fixed positioning, 260px width, 3-section structure
2. Unify color palette across all components
3. Standardize dashboard grid layout
4. Improve search component interactions
5. Update DataModeBadge format
6. Enhance bottom navigation consistency
7. Ensure full responsiveness and accessibility

**Non-negotiables**:
- Preserve all existing functionality (routing, auth, APIs)
- Keep Convex backend integrations intact
- Maintain all 353 passing tests
- No breaking changes to component APIs
- Backward compatibility with existing data formats

The redesign should be incremental, starting with the foundation (colors, spacing, sidebar) and building up through components and pages, always verifying that tests pass and functionality is preserved after each change.