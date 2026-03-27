---
name: dapps-design-system
description: Decentraland dApps design system reference. Use when building UI components that must match the Decentraland design language without depending on decentraland-ui2 at runtime. Contains the full theme specification (colors, typography, spacing, breakpoints) and a translation guide for converting MUI styled-component source into plain CSS. Read component source files from decentraland/ui2 on GitHub when recreating specific components.
---

# Decentraland dApps Design System

Build UI components that look and behave exactly like `decentraland-ui2` — without importing it at runtime. This skill contains the full theme specification and teaches you how to read the UI2 source files to reproduce any component.

Source repository: `decentraland/ui2`

**Canonical source:** This skill is a derived copy of the theme defined in `decentraland/ui2/src/theme/`. Tokens were extracted on 2026-01-27 from commit `d4bd7fb`. If values here conflict with the actual source files, **the repo wins** — read the source and update this skill.

---

## Part 1 — The Theme (exact values)

These are the design tokens extracted from the UI2 theme. Use them directly.

### 1.1 Colors

#### Neutral palette
| Token | Hex |
|-------|-----|
| white | `#FFFFFF` |
| softWhite | `#FCFCFC` |
| gray5 | `#ECEBED` |
| gray4 | `#CFCDD4` |
| gray3 | `#A09BA8` |
| gray2 | `#716B7C` |
| gray1 | `#5E5B67` |
| gray0 | `#43404A` |
| softBlack2 | `#242129` |
| softBlack1 | `#161518` |
| black | `#000000` |

#### Primary
| Token | Hex |
|-------|-----|
| primary | `#FF2D55` |
| primaryDark1 | `#F70038` |
| primaryDark2 | `#D80029` |
| primaryLight1 | `#F8919D` |
| primaryLight2 | `#FFC9D5` |

#### Brand
| Token | Hex |
|-------|-----|
| yellow | `#FFBC5B` |
| melon | `#FFA25A` |
| orange | `#FF7439` |
| ruby | `#FF2D55` |
| lavender | `#C640CD` |
| violet | `#A524B3` |
| purple | `#691FA9` |

#### Semantic
| Token | Main | Dark | Light |
|-------|------|------|-------|
| error | `#FB3B3B` | `#FB3B3B` | `#E97177` |
| warning | `#FE9C2A` | `#F38025` | `#FFB95B` |
| info | `#2196F3` | `#1A75D2` | `#63B4F6` |
| success | `#34CE77` | `#00B453` | `#65D890` |

#### Rarity
| Rarity | Color | Light variant | Light theme variant |
|--------|-------|---------------|---------------------|
| common | `#73D3D3` | `#D2F9F9` | `#49B7B7` |
| uncommon | `#FF8362` | `#F9E4DF` | `#FF8362` |
| rare | `#34CE76` | `#C1F2D6` | `#34CE76` |
| epic | `#438FFF` | `#C0D3EF` | `#438FFF` |
| legendary | `#A14BF3` | `#E1C1FF` | `#A14BF3` |
| exotic | `#9BD141` | `#D1E989` | `#9BD141` |
| mythic | `#FF4BED` | `#FDC4F7` | `#FF4BED` |
| unique | `#FEA217` | `#F3E5CF` | `#FEA217` |

- **Color** (`rarity`): base saturated colors
- **Light variant** (`rarityLight`): pastel tints for gradients
- **Light theme variant** (`rarityLightTheme`): used as `palette.rarities` in light theme — only `common` differs from base
- **Dark theme**: `palette.rarities` uses `hexToRgba(rarity.X, 0.2)` (20% opacity backgrounds), `palette.raritiesText` uses full-opacity base `rarity` colors

#### Gradients
| Name | Value |
|------|-------|
| flare | `linear-gradient(135deg, #FF2D55 0%, #FFBC5B 100%)` |
| cerise | `linear-gradient(135deg, #FF2D55 0%, #C640CD 100%)` |
| amin | `linear-gradient(135deg, #C640CD 0%, #691FA9 100%)` |
| gold | `linear-gradient(90deg, #F3C66B 0%, #9D7526 25%, #F6E59B 50%, #9D7526 75%, #F3C66B 100%)` |
| silver | `linear-gradient(90deg, #5E5E5E 0%, #626262 25%, #FFFFFF 50%, #6D6D6D 75%, #5E5E5E 100%)` |
| bronze | `linear-gradient(90deg, #FC801A 0%, #AF4300 25%, #FDCAA5 50%, #AF4300 75%, #FC801A 100%)` |

#### Opacity levels
| Name | Value |
|------|-------|
| backdrop | 0.6 |
| blurry | 0.4 |
| soft | 0.2 |
| subtle | 0.1 |

### 1.2 Light theme palette

```css
:root, .dcl-theme-light {
  /* Text */
  --dcl-text-primary: rgba(22, 21, 24, 0.9);
  --dcl-text-secondary: rgba(22, 21, 24, 0.6);
  --dcl-text-disabled: rgba(22, 21, 24, 0.38);

  /* Action states */
  --dcl-action-active: rgba(22, 21, 24, 0.56);
  --dcl-action-hover: rgba(22, 21, 24, 0.08);
  --dcl-action-selected: rgba(22, 21, 24, 0.16);
  --dcl-action-focus: rgba(22, 21, 24, 0.24);
  --dcl-action-disabled: rgba(22, 21, 24, 0.32);
  --dcl-action-disabled-bg: rgba(22, 21, 24, 0.12);

  /* Backgrounds */
  --dcl-bg-default: #FFFFFF;
  --dcl-bg-paper: #FFFFFF;
  --dcl-divider: rgba(22, 21, 24, 0.12);

  /* Primary states */
  --dcl-primary: #FF2D55;
  --dcl-primary-light: #F8919D;
  --dcl-primary-dark: #F70038;
  --dcl-primary-contrast: #FFFFFF;
  --dcl-primary-hover: rgba(255, 45, 85, 0.08);
  --dcl-primary-focus-visible: rgba(255, 45, 85, 0.16);
  --dcl-primary-outlined-border: rgba(255, 45, 85, 0.32);

  /* Secondary */
  --dcl-secondary-main: #43404A;
  --dcl-secondary-dark: #716B7C;
  --dcl-secondary-light: #CFCDD4;
  --dcl-secondary-contrast: #FCFCFC;

  /* Inputs */
  --dcl-input-standard-border: rgba(22, 21, 24, 0.42);
  --dcl-input-standard-hover: #161518;
  --dcl-input-filled-bg: rgba(22, 21, 24, 0.06);
  --dcl-input-filled-hover-bg: rgba(22, 21, 24, 0.09);
  --dcl-input-outlined-border: rgba(22, 21, 24, 0.23);
  --dcl-input-outlined-hover: #161518;

  /* Component backgrounds */
  --dcl-tooltip-bg: #5E5B67;
  --dcl-snackbar-bg: #43404A;
  --dcl-backdrop-bg: rgba(22, 21, 24, 0.5);
  --dcl-appbar-bg: rgba(255, 255, 255, 0.9);
  --dcl-card-overlay: rgba(255, 255, 255, 0.4);

  --dcl-icon-color: #000;
}
```

### 1.3 Dark theme palette

```css
.dcl-theme-dark {
  --dcl-text-primary: rgba(240, 240, 240, 1);
  --dcl-text-secondary: rgba(240, 240, 240, 0.7);
  --dcl-text-disabled: rgba(240, 240, 240, 0.38);

  --dcl-action-active: rgba(255, 255, 255, 0.56);
  --dcl-action-hover: rgba(255, 255, 255, 0.08);
  --dcl-action-selected: rgba(255, 255, 255, 0.16);
  --dcl-action-focus: rgba(255, 255, 255, 0.12);
  --dcl-action-disabled: rgba(255, 255, 255, 0.38);
  --dcl-action-disabled-bg: rgba(255, 255, 255, 0.12);

  --dcl-bg-default: #161518;
  --dcl-bg-paper: #1D1C20;
  --dcl-divider: rgba(255, 255, 255, 0.12);

  --dcl-primary: #FF2D55;
  --dcl-primary-light: #F8919D;
  --dcl-primary-dark: #F70038;
  --dcl-primary-contrast: #FFFFFF;
  --dcl-primary-hover: rgba(255, 45, 85, 0.08);
  --dcl-primary-focus-visible: rgba(255, 45, 85, 0.24);
  --dcl-primary-outlined-border: rgba(255, 45, 85, 0.5);

  --dcl-secondary-main: #43404A;
  --dcl-secondary-dark: #716B7C;
  --dcl-secondary-light: #CFCDD4;
  --dcl-secondary-contrast: #FCFCFC;

  /* Note: dark theme does NOT define input.standard tokens in colorSchemes.ts — MUI uses its own dark defaults */
  --dcl-input-outlined-border: rgba(255, 255, 255, 0.23);
  --dcl-input-outlined-hover: #FFFFFF;
  --dcl-input-filled-bg: rgba(255, 255, 255, 0.06);
  --dcl-input-filled-hover-bg: rgba(255, 255, 255, 0.09);

  --dcl-tooltip-bg: #242129;
  --dcl-snackbar-bg: #322F37;
  --dcl-backdrop-bg: rgba(22, 21, 24, 0.5);
  --dcl-appbar-bg: rgba(24, 20, 26, 0.9);
  --dcl-card-overlay: rgba(0, 0, 0, 0.4);

  --dcl-icon-color: #FFF;
}
```

### 1.4 Typography

Font stack: `Inter, Helvetica, Arial, sans-serif`
Hero font (special headings only): `DecentralandHero` (RoobertPRO-Bold, weight 700)

| Variant | Size | Weight | Line height | Letter spacing |
|---------|------|--------|-------------|----------------|
| h1 | 6rem (96px) | 600 | 1.167 | -1.5px |
| h2 | 3.75rem (60px) | 600 | 1.2 | -0.5px |
| h3 | 3rem (48px) | 600 | 1.167 | 0 |
| h4 | 2.125rem (34px) | 500 | 1.235 | 0.25px |
| h5 | 1.5rem (24px) | 500 | 1.334 | 0 |
| h6 | 1.25rem (20px) | 400 | 1.6 | 0.15px |
| subtitle1 | 1rem (16px) | 400 | 1.75 | 0.15px |
| subtitle2 | 0.875rem (14px) | 600 | 1.57 | 0.1px |
| body1 | 1rem (16px) | 400 | 1.5 | 0.15px |
| body2 | 0.875rem (14px) | 400 | 1.43 | 0.15px |
| caption | 0.75rem (12px) | 400 | 1.66 | 0.4px |
| overline | 0.75rem (12px) | 400 | 2.66 | 1px |

#### Button typography

All buttons: UPPERCASE, weight 600, Inter font.

| Size | Font size | Padding | Letter spacing |
|------|-----------|---------|----------------|
| Large | 0.9375rem (15px) | 8px 22px | 0.46px |
| Medium | 0.875rem (14px) | 6px 16px | 0.4px |
| Small | 0.8125rem (13px) | 4px 10px | 0.46px |

### 1.5 Spacing

Base unit: **8px**. Use `n * 8px` for all spacing values.

| Expression | Value |
|------------|-------|
| spacing(0.25) | 2px |
| spacing(0.5) | 4px |
| spacing(0.75) | 6px |
| spacing(1) | 8px |
| spacing(1.5) | 12px |
| spacing(2) | 16px |
| spacing(3) | 24px |
| spacing(4) | 32px |
| spacing(5) | 40px |
| spacing(6) | 48px |

### 1.6 Breakpoints

| Name | px | Media query (down) | Media query (up) |
|------|----|--------------------|-------------------|
| xs | 768 | `@media (max-width: 767px)` | `@media (min-width: 768px)` |
| sm | 991 | `@media (max-width: 990px)` | `@media (min-width: 991px)` |
| md | 1024 | `@media (max-width: 1023px)` | `@media (min-width: 1024px)` |
| lg | 1280 | `@media (max-width: 1279px)` | `@media (min-width: 1280px)` |
| xl | 1500 | `@media (max-width: 1499px)` | `@media (min-width: 1500px)` |

### 1.7 Shape

| Context | Border radius |
|---------|---------------|
| Global default | 6px |
| Cards | 16px (`spacing(2)`) |
| Card inner elements | 8px (`spacing(1)`) |
| Modals | 12px |
| Badges | 8–16px |
| Pills / Ripple | 100px |

### 1.8 Shadows

| Usage | Value |
|-------|-------|
| Button hover (elevation 2) | `0px 3px 1px -2px rgba(0,0,0,0.2), 0px 2px 2px 0px rgba(0,0,0,0.14), 0px 1px 5px 0px rgba(0,0,0,0.12)` |
| Card hover glow | `0px 0px 20px 6px rgba({color}, 0.37)` — use `#DD56FF` for events, rarity color for catalog |
| None | `none` |

### 1.9 Transitions

| Speed | Value | Used for |
|-------|-------|----------|
| Complex | `300ms ease` | Most hover animations (MUI `duration.complex`) |
| Fast | `200ms cubic-bezier(0.1, 1, 0.15, 1)` | AppBar, button shadows |
| Medium | `0.3s ease-in-out` | Card shadows, opacity fades |

### 1.10 Keyframe animations

```css
/* Card coin-flip on hover (EventCard) */
@keyframes coinFlip {
  0%   { transform: perspective(800px) rotateX(0deg) rotateY(0deg); }
  15%  { transform: perspective(800px) rotateX(5deg) rotateY(1deg); }
  30%  { transform: perspective(800px) rotateX(4deg) rotateY(3deg); }
  50%  { transform: perspective(800px) rotateX(0deg) rotateY(5deg); }
  70%  { transform: perspective(800px) rotateX(-4deg) rotateY(3deg); }
  85%  { transform: perspective(800px) rotateX(-2deg) rotateY(1deg); }
  100% { transform: perspective(800px) rotateX(0deg) rotateY(0deg); }
}

/* Opacity pulse (Live badge dot) */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}

/* Scale pulse (Live badge icon) */
@keyframes livePulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.3); }
}
```

---

## Part 2 — How to Read UI2 Source Files

The UI2 components are built with MUI's `styled()` API. This section teaches you how to read those files and translate them to plain CSS.

### 2.1 Reading source from GitHub

Fetch files directly via raw GitHub URLs (no auth required):

```
https://raw.githubusercontent.com/decentraland/ui2/main/src/components/{Name}/{Name}.styled.ts
```

If `gh` CLI is available:

```bash
gh api repos/decentraland/ui2/contents/src/components/{Name}/{Name}.styled.ts --jq '.content' | base64 -d
```

### 2.2 MUI styled() → CSS translation guide

UI2 styled components look like this:

```typescript
const MyComponent = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  color: theme.palette.text.primary,
  fontSize: theme.typography.h6.fontSize,
  fontWeight: theme.typography.fontWeightBold,
  borderRadius: theme.spacing(1),
  backgroundColor: theme.palette.background.default,
  [theme.breakpoints.down('sm')]: {
    padding: theme.spacing(1)
  },
  '&:hover': {
    backgroundColor: theme.palette.action.hover
  }
}))
```

Translation rules:

| MUI expression | CSS equivalent |
|----------------|----------------|
| `theme.spacing(n)` | `n * 8px` → e.g. `theme.spacing(2)` = `16px` |
| `theme.spacing(1, 2)` | `8px 16px` (vertical, horizontal) |
| `theme.palette.text.primary` | `var(--dcl-text-primary)` |
| `theme.palette.text.secondary` | `var(--dcl-text-secondary)` |
| `theme.palette.background.default` | `var(--dcl-bg-default)` |
| `theme.palette.background.paper` | `var(--dcl-bg-paper)` |
| `theme.palette.primary.main` | `var(--dcl-primary)` |
| `theme.palette.primary.dark` | `var(--dcl-primary-dark)` |
| `theme.palette.primary.light` | `var(--dcl-primary-light)` |
| `theme.palette.primary.contrastText` | `var(--dcl-primary-contrast)` |
| `theme.palette.error.main` | `#FB3B3B` |
| `theme.palette.success.main` | `#34CE77` |
| `theme.palette.action.hover` | `var(--dcl-action-hover)` |
| `theme.palette.action.selected` | `var(--dcl-action-selected)` |
| `theme.palette.action.disabled` | `var(--dcl-action-disabled)` |
| `theme.palette.divider` | `var(--dcl-divider)` |
| `theme.palette.common.white` | `#FFFFFF` |
| `theme.palette.mode === 'dark'` | Use the `var(--dcl-card-overlay)` token, or define both in light/dark CSS |
| `theme.typography.h6.fontSize` | `1.25rem` (see typography table) |
| `theme.typography.body2.fontSize` | `0.875rem` |
| `theme.typography.caption.fontSize` | `0.75rem` |
| `theme.typography.fontWeightBold` | `700` |
| `theme.typography.overline.letterSpacing` | `1px` |
| `theme.shape.borderRadius` | `6px` |
| `theme.transitions.create('X', { duration: theme.transitions.duration.complex })` | `X 300ms ease` |
| `theme.transitions.duration.complex` | `300ms` |
| `[theme.breakpoints.down('sm')]` | `@media (max-width: 990px)` |
| `[theme.breakpoints.up('sm')]` | `@media (min-width: 991px)` |
| `[theme.breakpoints.down('xs')]` | `@media (max-width: 767px)` |
| `hexToRgba('#DD56FF', 0.37)` | `rgba(221, 86, 255, 0.37)` — convert hex to RGB manually |
| `gradient.flare` | `linear-gradient(135deg, #FF2D55 0%, #FFBC5B 100%)` |
| `gradient.cerise` | `linear-gradient(135deg, #FF2D55 0%, #C640CD 100%)` |

#### MUI hover selectors → CSS

| MUI selector | CSS equivalent |
|--------------|----------------|
| `'&:hover': { ... }` | `.my-element:hover { ... }` |
| `'&:focus-visible': { ... }` | `.my-element:focus-visible { ... }` |
| `'.MuiCardActionArea-root:hover &': { ... }` | `.dcl-card:hover .my-element { ... }` (parent hover triggers child change) |
| `'& .MuiTypography-root': { ... }` | `.my-element > p, .my-element > span { ... }` (child typography) |
| `'& .MuiChip-label': { ... }` | `.my-chip .chip-label { ... }` |
| `'&:last-child': { paddingBottom: X }` | `.my-element:last-child { padding-bottom: X; }` |

#### Conditional styling (spread operator)

```typescript
// MUI source
const LeftBadge = styled(Box)<{ transparent?: boolean }>(({ theme, transparent }) => ({
  ...(!transparent && {
    padding: theme.spacing(1),
    backgroundColor: theme.palette.background.default,
  }),
  color: theme.palette.text.primary
}))
```

CSS translation — use a modifier class:

```css
.dcl-left-badge { color: var(--dcl-text-primary); }
.dcl-left-badge:not(.dcl-left-badge--transparent) {
  padding: 8px;
  background-color: var(--dcl-bg-default);
}
```

### 2.3 Available components in UI2

| Component | Directory | Key styled file |
|-----------|-----------|-----------------|
| Address | `Address/` | `Address.styled.ts` |
| AnimatedBackground | `AnimatedBackground/` | `AnimatedBackground.styled.ts` |
| AssetImage | `AssetImage/` | `AssetImage.styled.ts` |
| AvatarFace | `AvatarFace/` | `AvatarFace.styled.ts` |
| Badges (Number, Text, Live, UserCount) | `Badges/` | `Badges.styled.ts` |
| Banner | `Banner/` | `Banner.styled.ts` |
| Blockie | `Blockie/` | `Blockie.styled.ts` |
| Button | `Button/` | `Button.tsx` |
| CatalogCard | `CatalogCard/` | `CatalogCard.styled.ts` |
| ChainSelector | `ChainSelector/` | `ChainSelector.styled.tsx` |
| CreditsToggle | `CreditsToggle/` | `CreditsToggle.styled.ts` |
| DownloadButton | `DownloadButton/` | `DownloadButton.styled.ts` |
| EventCard | `EventCard/` | `EventCard.styled.ts` |
| Footer | `Footer/` | `Footer.styled.ts` |
| FooterLanding | `FooterLanding/` | `FooterLanding.styled.ts` |
| Icon | `Icon/` | (various icon components) |
| IconBadge | `IconBadge/` | `IconBadge.styled.ts` |
| JumpIn | `JumpIn/` | `JumpIn.styled.ts` |
| LanguageDropdown | `LanguageDropdown/` | `LanguageDropdown.styled.ts` |
| Logo | `Logo/` | `Logo.styled.ts` |
| Mana | `Mana/` | `Mana.styled.ts` |
| Modal | `Modal/` | `Modal.styled.ts` |
| Navbar | `Navbar/` | `Navbar.styled.ts` |
| Notifications | `Notifications/` | `Notifications.styled.tsx` |
| Profile | `Profile/` | `Profile.styled.ts` |
| RarityBadge | `RarityBadge/` | `RarityBadge.styled.ts` |
| SceneCard | `SceneCard/` | `SceneCard.styled.ts` |
| Table | `Table/` | `Table.styled.ts` |
| UserLabel | `UserLabel/` | `UserLabel.styled.ts` |
| UserMenu | `UserMenu/` | `UserMenu.styled.tsx` |
| WearablePreview | `WearablePreview/` | `WearablePreview.styled.ts` |

---

## Part 3 — Component Patterns

These are the recurring patterns used across all UI2 components. Apply them to any new component you build.

### 3.1 Card pattern

All cards (EventCard, SceneCard, CatalogCard) follow this structure:

```
┌─────────────────────────────┐
│  BadgesContainer (absolute) │  ← top: 16px, left: 16px, right: 16px, z-index: 10
│  ┌─────────┐   ┌─────────┐ │
│  │LeftBadge│   │RightBadge│ │  ← space-between
│  └─────────┘   └─────────┘ │
├─────────────────────────────┤
│                             │
│        Media/Image          │  ← background-size: cover, top corners rounded
│                             │
├─────────────────────────────┤
│  Content (semi-transparent) │  ← dark: rgba(0,0,0,0.4), light: rgba(255,255,255,0.4)
│  ┌─────────────────────────┐│
│  │ Title (h6, 2-line clamp)││
│  │ Avatar row + Location   ││
│  └─────────────────────────┘│
│  ┌─────────────────────────┐│
│  │ JumpIn button (on hover)││  ← slides up from bottom on hover
│  └─────────────────────────┘│
└─────────────────────────────┘
```

Key CSS behaviors:
- Card border-radius: `16px`
- On hover (desktop only, `min-width: 991px`):
  - Box shadow glow: `0px 0px 20px 6px rgba(221, 86, 255, 0.37)`
  - Image height shrinks (329px → 271px)
  - JumpIn button slides up (opacity 0→1, translateY→0)
  - Location chip slides in (opacity 0→1, translateX(20px)→0)
  - Content margin-bottom increases to make room for JumpIn
- Background: transparent (the image and content overlay create the visual)
- Loading state: skeleton rectangles and circles in same layout

### 3.2 Badge patterns

| Badge type | Size | Background | Text | Border radius | Extra |
|------------|------|------------|------|---------------|-------|
| NumberBadge | 50×50px (38×38 mobile) | gradient flare | theme text on bg-default inner circle | 16px (12px mobile) | 3px padding for inner circle |
| TextBadge | auto | gradient cerise | white, bold, uppercase, 20px (14px mobile) | 12px | letter-spacing: 1px |
| LiveBadge | 26px height | error `#FB3B3B` | white, bold, uppercase, caption size | 8px | dot pulses opacity, icon pulses scale |
| UserCountBadge | 26px height | bg-default | text-primary, bold, caption size | 8px | green dot `#34CE77` |

### 3.3 Button pattern (JumpIn)

```css
.dcl-jump-in-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 46px;
  border: none;
  border-radius: 16px;
  background-color: var(--dcl-primary);       /* #FF2D55 */
  color: var(--dcl-primary-contrast);          /* white */
  font-size: 16px;
  font-weight: 700;
  text-transform: uppercase;
  cursor: pointer;
}
.dcl-jump-in-btn:hover { background-color: var(--dcl-primary-dark); }
.dcl-jump-in-btn:active { background-color: var(--dcl-primary-dark); }
.dcl-jump-in-btn:focus-visible {
  outline: 2px solid var(--dcl-primary);
  outline-offset: 2px;
}
```

### 3.4 Modal pattern

| Size | Width |
|------|-------|
| default | 900px |
| small | 720px |
| tiny | 540px |
| mobile (below xs) | 100vw × 100vh |

- Border-radius: 12px
- Title: 24px padding, flex row, space-between (title + close button)
- Content: 24px padding
- Actions: 24px padding, flex row, children flex: 1, 16px gap between buttons
- Backdrop: `var(--dcl-backdrop-bg)` with blur

### 3.5 Interactive states (MUST for every clickable element)

```css
.dcl-interactive {
  outline: none;
  cursor: pointer;
  transition: background-color 300ms ease, box-shadow 300ms ease;
}
.dcl-interactive:hover { background-color: var(--dcl-action-hover); }
.dcl-interactive:active { background-color: var(--dcl-action-selected); }
.dcl-interactive:focus-visible {
  outline: 2px solid var(--dcl-primary);
  outline-offset: 2px;
}
.dcl-interactive:disabled,
.dcl-interactive[aria-disabled="true"] {
  opacity: 0.5;
  pointer-events: none;
}
```

### 3.6 Text clamping (titles)

```css
.dcl-line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
}
```

### 3.7 Scrollbar

```css
::-webkit-scrollbar { width: 10px; height: 10px; -webkit-appearance: none; }
::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.1); }
::-webkit-scrollbar-thumb { cursor: pointer; border-radius: 5px; background: rgba(0, 0, 0, 0.25); transition: color 0.2s ease; }
```

### 3.8 AppBar (frosted glass)

```css
.dcl-appbar {
  backdrop-filter: saturate(180%) blur(20px);
  background-color: var(--dcl-appbar-bg);
  background-image: none;
  transition: box-shadow 200ms cubic-bezier(0.1, 1, 0.15, 1), background-image 200ms cubic-bezier(0.1, 1, 0.15, 1);
}
```

---

## Part 4 — Full Example: EventCard → Plain CSS

This is the real EventCard from UI2, translated line-by-line to plain HTML/CSS. Use this as a reference for how to translate any component.

### HTML structure

```html
<div class="dcl-event-card">
  <div class="dcl-event-card__action-area">
    <!-- Badges (optional) -->
    <div class="dcl-event-card__badges">
      <div class="dcl-event-card__left-badge">LIVE</div>
      <!-- right badge slot -->
    </div>

    <!-- Image -->
    <div class="dcl-event-card__media-container">
      <div class="dcl-event-card__media" style="background-image: url('...')"></div>
    </div>

    <!-- Content -->
    <div class="dcl-event-card__content">
      <div class="dcl-event-card__info">
        <div class="dcl-event-card__title">
          <h6 class="dcl-line-clamp-2">Scene Name Here</h6>
        </div>
        <div class="dcl-event-card__avatar-row">
          <div class="dcl-event-card__avatar">
            <img class="dcl-avatar-face" src="..." alt="" />
            <span class="dcl-event-card__avatar-text">by <a href="#">UserName</a></span>
          </div>
          <div class="dcl-event-card__location-container">
            <!-- Note: the real component uses an SVG LocationIcon, not an emoji -->
            <div class="dcl-event-card__location-chip"><svg>...</svg> -20, 50</div>
          </div>
        </div>
      </div>
      <div class="dcl-event-card__jump-in-container">
        <!-- Note: the real component uses an SVG JumpInIcon, not a text arrow -->
        <button class="dcl-jump-in-btn">JUMP IN <svg>...</svg></button>
      </div>
    </div>
  </div>
</div>
```

### CSS

```css
/* --- Card container --- */
.dcl-event-card {
  border-radius: 16px;
  min-width: 400px;
  max-width: 850px;
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  background-color: transparent;
  position: relative;
  overflow: hidden;
  transition: transform 300ms ease, box-shadow 300ms ease;
}
@media (min-width: 991px) {
  .dcl-event-card:hover {
    box-shadow: 0px 0px 20px 6px rgba(221, 86, 255, 0.37);
    animation: coinFlip 0.8s ease-in-out;
  }
}

/* --- Action area (full card clickable) --- */
.dcl-event-card__action-area {
  border-radius: 16px;
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  background-color: transparent;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
}

/* --- Badges overlay --- */
.dcl-event-card__badges {
  position: absolute;
  top: 16px; left: 16px; right: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  z-index: 10;
  pointer-events: none;
}
.dcl-event-card__badges > * { pointer-events: auto; }

.dcl-event-card__left-badge {
  padding: 8px;
  min-width: 32px; height: 32px;
  background-color: var(--dcl-bg-default);
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 700;
  max-width: 45%;
  color: var(--dcl-text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.dcl-event-card__left-badge--transparent {
  padding: 0;
  min-width: unset; height: unset;
  background-color: transparent;
  border-radius: 0;
}

/* --- Image --- */
.dcl-event-card__media-container {
  position: relative;
  width: 100%;
  overflow: hidden;
}
.dcl-event-card__media {
  height: 329px;
  width: 100%;
  border-radius: 16px 16px 0 0;
  background-size: cover;
  background-position: center;
}
@media (min-width: 991px) {
  .dcl-event-card__media {
    transition: height 300ms ease;
  }
  .dcl-event-card__action-area:hover .dcl-event-card__media {
    height: 271px;
  }
}

/* --- Content area --- */
.dcl-event-card__content {
  background-color: var(--dcl-card-overlay);
  border-radius: 0 0 16px 16px;
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  position: relative;
  overflow: hidden;
  padding: 16px;
}

/* --- Title --- */
.dcl-event-card__title h6 {
  font-family: Inter, Helvetica, Arial, sans-serif;
  font-size: 1.25rem;
  font-weight: 400;
  line-height: 1.6;
  margin: 0 0 8px 0;
}

/* --- Avatar row --- */
.dcl-event-card__avatar-row {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  min-width: 0;
}
@media (min-width: 991px) {
  .dcl-event-card__avatar-row {
    transition: margin-bottom 300ms ease;
  }
  .dcl-event-card__action-area:hover .dcl-event-card__avatar-row {
    margin-bottom: 62px; /* 46px button + 16px gap */
  }
}

.dcl-event-card__avatar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex: 1 1 auto;
  max-width: 50%;
  overflow: hidden;
}
@media (max-width: 990px) {
  .dcl-event-card__avatar { max-width: 100%; }
}

.dcl-event-card__avatar-text {
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dcl-event-card__avatar-text a {
  text-decoration: none;
  font-weight: 700;
}
.dcl-event-card__avatar-text a:hover { text-decoration: none; }

/* --- Location chip (appears on hover) --- */
.dcl-event-card__location-container {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 50%;
  display: flex;
  justify-content: flex-end;
  opacity: 0;
  height: 0;
  overflow: hidden;
  transform: translateX(20px);
  transition: opacity 300ms ease, height 300ms ease, transform 300ms ease;
}
.dcl-event-card__action-area:hover .dcl-event-card__location-container {
  opacity: 1;
  height: auto;
  transform: translateX(0);
}
@media (max-width: 767px) {
  .dcl-event-card__location-container { display: none; }
}

.dcl-event-card__location-chip {
  background-color: var(--dcl-card-overlay);
  color: var(--dcl-text-primary);
  cursor: pointer;
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 0.8125rem;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- Jump In button (appears on hover) --- */
.dcl-event-card__jump-in-container {
  position: absolute;
  bottom: 16px; left: 16px; right: 16px;
  opacity: 0;
  transform: translateY(calc(100% + 16px));
  transition: opacity 300ms ease, transform 300ms ease;
}
@media (min-width: 991px) {
  .dcl-event-card__action-area:hover .dcl-event-card__jump-in-container {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 767px) {
  .dcl-event-card__jump-in-container { display: none; }
}

/* --- Coin flip animation --- */
@keyframes coinFlip {
  0%   { transform: perspective(800px) rotateX(0deg) rotateY(0deg); }
  15%  { transform: perspective(800px) rotateX(5deg) rotateY(1deg); }
  30%  { transform: perspective(800px) rotateX(4deg) rotateY(3deg); }
  50%  { transform: perspective(800px) rotateX(0deg) rotateY(5deg); }
  70%  { transform: perspective(800px) rotateX(-4deg) rotateY(3deg); }
  85%  { transform: perspective(800px) rotateX(-2deg) rotateY(1deg); }
  100% { transform: perspective(800px) rotateX(0deg) rotateY(0deg); }
}
```

---

## Part 5 — Generation Workflow

When asked to create a component:

### Step 1 — Identify if a similar component exists in UI2

Check the component table in Part 2.3. If a similar component exists, read its source files:

Fetch via raw URLs (no auth needed):

```
https://raw.githubusercontent.com/decentraland/ui2/main/src/components/{Name}/{Name}.styled.ts
https://raw.githubusercontent.com/decentraland/ui2/main/src/components/{Name}/{Name}.types.ts
https://raw.githubusercontent.com/decentraland/ui2/main/src/components/{Name}/{Name}.tsx
```

Or via `gh` CLI if available:

```bash
gh api repos/decentraland/ui2/contents/src/components/{Name}/{Name}.styled.ts --jq '.content' | base64 -d
```

### Step 2 — Translate using Part 2.2

Use the translation table to convert every `theme.spacing()`, `theme.palette.*`, `theme.typography.*`, `theme.breakpoints.*`, and `theme.transitions.*` call into plain CSS.

### Step 3 — Apply the patterns from Part 3

- Cards → use the card pattern (3.1)
- Badges → use the badge pattern (3.2)
- Buttons → use the button pattern (3.3)
- Modals → use the modal pattern (3.4)
- All interactive elements → apply interactive states (3.5)
- Titles → apply line clamping (3.6)

### Step 4 — Output format

1. Include the CSS custom properties from Part 1.2/1.3 (light and dark themes)
2. Use BEM-like class naming: `.dcl-{component}`, `.dcl-{component}__{element}`, `.dcl-{component}--{modifier}`
3. No framework dependencies unless the target project uses one
4. If the target uses React, output a functional component with `className` props
5. Include all hover/focus/disabled states
6. Include responsive breakpoints where the source uses them

### Step 5 — Validate

Compare your output against the source:

1. Do the colors match the palette?
2. Do spacing values match `theme.spacing()` calculations?
3. Are hover animations present (desktop only)?
4. Are responsive breakpoints correct?
5. Does the loading/skeleton state exist if the source has one?
