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
        prism: {
          light: '#5e7ce2',
          DEFAULT: '#3a5da6',
          dark: '#1b2c52',
          accent: '#38bdf8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
