/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // PRISM palette — dark navy + light blue.
        navy: {
          50: '#eef2f9',
          100: '#dbe4f3',
          200: '#b8c9e7',
          300: '#8ba6d6',
          400: '#5b7dc0',
          500: '#3a5da6',
          600: '#2c4783',
          700: '#243a6b',
          800: '#1b2c52',
          900: '#0f1b34',
          950: '#0a1226',
        },
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
