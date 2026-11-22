module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        white: '#f4f1e8',
        slate: {
          50: '#f7f6f2',
          100: '#efeee9',
          200: '#deddd6',
          300: '#c3c1b6',
          400: '#aaa89e',
          500: '#929087',
          600: '#77766c',
          700: '#5b5a52',
          800: '#3d3e37',
          900: '#2a2b26',
          950: '#171815',
        },
        brand: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#c2410c',
          500: '#b45309',
          600: '#92400e',
          700: '#7c2d12',
          800: '#65250d',
          900: '#431407',
        },
      },
      boxShadow: {
        soft: '0 12px 28px rgba(0, 0, 0, 0.2)',
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '0.875rem',
      },
    },
  },
  plugins: [],
};
