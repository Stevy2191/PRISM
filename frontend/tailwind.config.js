/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Class-based dark mode: a `.dark` class on <html> flips the theme.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // The navy scale is CSS-variable driven so the whole app can flip between
        // light and dark themes at runtime (see index.css :root / .dark).
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
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
