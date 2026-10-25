/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Attribute-based dark mode: data-theme="dark" on <html> flips the theme
  // (set by ThemeContext.jsx). Enables `dark:` variants if ever needed,
  // though today theming is done via the CSS-variable indirection below.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // The navy scale is CSS-variable driven so the whole app can flip between
        // light and dark themes at runtime (see index.css [data-theme] blocks).
        navy: {
          50: 'rgb(var(--navy-50) / <alpha-value>)',
          100: 'rgb(var(--navy-100) / <alpha-value>)',
          200: 'rgb(var(--navy-200) / <alpha-value>)',
          300: 'rgb(var(--navy-300) / <alpha-value>)',
          400: 'rgb(var(--navy-400) / <alpha-value>)',
          500: 'rgb(var(--navy-500) / <alpha-value>)',
          600: 'rgb(var(--navy-600) / <alpha-value>)',
          700: 'rgb(var(--navy-700) / <alpha-value>)',
          800: 'rgb(var(--navy-800) / <alpha-value>)',
          900: 'rgb(var(--navy-900) / <alpha-value>)',
          950: 'rgb(var(--navy-950) / <alpha-value>)',
        },
        // Card/input surface — white in light mode, dark slate in dark mode.
        surface: 'rgb(var(--surface) / <alpha-value>)',
        // Primary + accent are driven by CSS variables so admin rebranding
        // applies globally at runtime. The rgb-triplet form keeps Tailwind's
        // opacity modifiers (e.g. bg-prism/10) working.
        prism: {
          light: '#5e7ce2',
          DEFAULT: 'rgb(var(--brand-primary-rgb) / <alpha-value>)',
          dark: '#1b2c52',
          accent: 'rgb(var(--brand-accent-rgb) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        // Look A has a single typeface. `font-mono` is kept so existing
        // identifier/metric markup keeps working: it resolves to the same sans
        // (tabular figures come from index.css). Code blocks use --font-mono.
        mono: ['"Instrument Sans"', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      // Look A radii: 8 controls, 10 inner panels, 12 cards. `full` untouched.
      borderRadius: {
        DEFAULT: '6px',
        sm: '4px',
        md: '8px',
        lg: '10px',
        xl: '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.06)',
        DEFAULT: '0 1px 2px 0 rgb(0 0 0 / 0.08)',
        md: '0 2px 6px -1px rgb(0 0 0 / 0.14)',
        lg: '0 8px 24px -6px rgb(0 0 0 / 0.28)',
      },
      letterSpacing: {
        // Used by eyebrow labels / uppercase section headers.
        eyebrow: '0.14em',
      },
    },
  },
  plugins: [],
};
