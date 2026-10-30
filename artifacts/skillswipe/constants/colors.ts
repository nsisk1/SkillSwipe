/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

export const backgroundOptions = [
  { id: 'default', label: 'Default', light: '#e4e1d8', dark: '#0f211c' },
  { id: 'sage', label: 'Soft sage', light: '#d6ded5', dark: '#15261f' },
  { id: 'blue', label: 'Misty blue', light: '#d7dee4', dark: '#172632' },
  { id: 'rose', label: 'Muted rose', light: '#e4d8d4', dark: '#2f201c' },
  { id: 'lavender', label: 'Lavender', light: '#ddd9e4', dark: '#242033' },
] as const;

export type BackgroundOptionId = (typeof backgroundOptions)[number]['id'];

const colors = {
  light: {
    text: '#17372e',
    tint: '#e66d51',
    background: '#e4e1d8',
    foreground: '#17372e',
    card: '#fffdf7',
    cardForeground: '#193b31',
    primary: '#1c4c3d',
    primaryForeground: '#fffdf7',
    secondary: '#e8ebe2',
    secondaryForeground: '#23483a',
    muted: '#e9ece4',
    mutedForeground: '#718078',
    accent: '#e66d51',
    accentForeground: '#fffaf5',
    destructive: '#c95446',
    destructiveForeground: '#fffaf5',
    border: '#dce4da',
    input: '#dce4da',
  },

  dark: {
    text: '#f4f2e8',
    tint: '#f08a6d',
    background: '#0f211c',
    foreground: '#f4f2e8',
    card: '#1c372f',
    cardForeground: '#f6f2e7',
    primary: '#cae18d',
    primaryForeground: '#19372d',
    secondary: '#28453b',
    secondaryForeground: '#e5ebdd',
    muted: '#223c33',
    mutedForeground: '#a2b1a5',
    accent: '#f08a6d',
    accentForeground: '#241c19',
    destructive: '#ef7867',
    destructiveForeground: '#241c19',
    border: '#355247',
    input: '#355247',
  },

  radius: 24,
};

export default colors;
