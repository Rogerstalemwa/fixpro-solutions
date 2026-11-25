/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: 'rgb(var(--navy-950) / <alpha-value>)', 900: 'rgb(var(--navy-900) / <alpha-value>)', 800: 'rgb(var(--navy-800) / <alpha-value>)',
          700: 'rgb(var(--navy-700) / <alpha-value>)', 600: 'rgb(var(--navy-600) / <alpha-value>)',
        },
        lime: { DEFAULT: '#BDF23D', dim: '#8FB82B' },
        accent: 'rgb(var(--accent) / <alpha-value>)',
        logo: 'rgb(var(--logo) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        mist: 'rgb(var(--mist) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        white: 'rgb(var(--white) / <alpha-value>)',
        black: 'rgb(var(--black) / <alpha-value>)',
      },
      keyframes: {
        fadeUp: { '0%': { opacity: 0, transform: 'translateY(14px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        slideIn: { '0%': { transform: 'translateX(100%)' }, '100%': { transform: 'translateX(0)' } },
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        pulseRing: { '0%': { boxShadow: '0 0 0 0 rgba(189,242,61,.45)' }, '100%': { boxShadow: '0 0 0 10px rgba(189,242,61,0)' } },
      },
      animation: {
        'fade-up': 'fadeUp .5s ease-out both',
        'slide-in': 'slideIn .28s ease-out both',
        'fade-in': 'fadeIn .2s ease-out both',
        float: 'float 6s ease-in-out infinite',
        marquee: 'marquee 45s linear infinite',
        'page-in': 'fadeUp .5s ease-out backwards',
        'pulse-ring': 'pulseRing 1.8s ease-out infinite',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
