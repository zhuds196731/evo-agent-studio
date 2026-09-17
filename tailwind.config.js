/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
        },
        jade: {
          300: 'rgb(var(--jade-300) / <alpha-value>)',
          400: 'rgb(var(--jade-400) / <alpha-value>)',
          500: 'rgb(var(--jade-500) / <alpha-value>)',
          600: 'rgb(var(--jade-600) / <alpha-value>)',
        },
        royal: {
          300: 'rgb(var(--royal-300) / <alpha-value>)',
          400: 'rgb(var(--royal-400) / <alpha-value>)',
          500: 'rgb(var(--royal-500) / <alpha-value>)',
          600: 'rgb(var(--royal-600) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--royal-500) / .18), 0 10px 30px -18px rgb(var(--royal-500) / .45)',
      },
    },
  },
  plugins: [],
};
