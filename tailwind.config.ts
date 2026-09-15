import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f172a',
        slate: {
          150: '#e9eef5',
        },
        brand: {
          50: '#eef4ff',
          100: '#dbe7ff',
          200: '#bed2ff',
          300: '#92b4ff',
          400: '#5f8bfa',
          500: '#3a67ed',
          600: '#274bd1',
          700: '#1f3ba6',
          800: '#1d3583',
          900: '#1c2f68',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)',
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
    },
  },
  plugins: [],
} satisfies Config;
