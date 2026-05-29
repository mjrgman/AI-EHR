/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Measured Canon brand palette (portfolio brand) ──
        // Base hexes are the *600/700* anchor of each scale; 50-900 derived around them.
        navy: {
          50: '#eef2f6',
          100: '#d4dde6',
          200: '#a8bbcd',
          300: '#7593ad',
          400: '#4a6b8a',
          500: '#2c506f',
          600: '#1a3a52', // brand navy — authority
          700: '#163046',
          800: '#112536',
          900: '#0b1923',
        },
        ivory: {
          50: '#fefdfb',
          100: '#faf7f0',
          200: '#f5f1e8', // brand ivory — warm app canvas
          300: '#ece5d6',
          400: '#ddd2bc',
          500: '#c9ba9c',
          600: '#a89572',
          700: '#827258',
          800: '#5c5040',
          900: '#3a3329',
        },
        offWhite: {
          50: '#ffffff',
          100: '#fefdfb', // brand offWhite — card/interior surfaces
          200: '#fcfaf5',
          300: '#f8f4ec',
          400: '#f2ece0',
          500: '#e8dfcd',
          600: '#cdbf9f',
          700: '#a08f6a',
          800: '#6f6248',
          900: '#3d3527',
        },
        slate: {
          50: '#eef1f5',
          100: '#d6dde6',
          200: '#b3c0cf',
          300: '#8a9bb1',
          400: '#677c97',
          500: '#4a5f7f', // brand slate — secondary text, labels, rules
          600: '#3f5170',
          700: '#33425b',
          800: '#273344',
          900: '#1a222e',
        },
        gold: {
          50: '#fbf6e7',
          100: '#f4e8c2',
          200: '#e9d088',
          300: '#dab948',
          400: '#c99e1f',
          500: '#b8860b', // brand gold — RARE accent only
          600: '#9c7109',
          700: '#7c5a08',
          800: '#5c4306',
          900: '#3d2c04',
        },
        danger: {
          50: '#fbeae8',
          100: '#f5cbc6',
          200: '#e9a098',
          300: '#dc7468',
          400: '#c54e41',
          500: '#a1322a', // brand danger — allergy alerts, alarms, no-show
          600: '#8a2922',
          700: '#6e201b',
          800: '#521814',
          900: '#36100d',
        },
        success: {
          50: '#e9f2ec',
          100: '#c7dccf',
          200: '#9bc0a8',
          300: '#6ba27e',
          400: '#4f8c63',
          500: '#3f7a52', // brand success — signed, normal, compliant
          600: '#356845',
          700: '#2a5337',
          800: '#1f3e29',
          900: '#14281b',
        },
        clinical: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#b9e5fe',
          300: '#7cd4fd',
          400: '#36bffa',
          500: '#0ca5eb',
          600: '#0084c9',
          700: '#016aa3',
          800: '#065986',
          900: '#0b4a6f',
          950: '#072f4a',
        },
        teal: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        }
      },
      fontFamily: {
        // Measured Canon type system
        display: ['Source Serif 4', 'Georgia', 'Cambria', 'Times New Roman', 'serif'], // editorial authority — titles/headings/wordmark
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'], // clinical legibility — body/data/tables/inputs
        body: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        clinical: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', 'monospace'],
      },
      boxShadow: {
        // Soft layered Measured Canon depth (warm, not flat, not harsh)
        'mc': '0 1px 2px rgba(26,58,82,0.04), 0 2px 8px rgba(26,58,82,0.06)',
        'mc-lg': '0 2px 6px rgba(26,58,82,0.05), 0 8px 24px rgba(26,58,82,0.10)',
        'mc-xl': '0 4px 12px rgba(26,58,82,0.07), 0 16px 48px rgba(26,58,82,0.14)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
        'slide-in-right': 'slideInRight 0.25s ease-out',
        'pulse-record': 'pulseRecord 1.5s ease-in-out infinite',
        'scale-in': 'scaleIn 0.15s ease-out',
        'reveal': 'reveal 0.5s cubic-bezier(0.16,1,0.3,1) both', // staggered page-load reveal
      },
      keyframes: {
        reveal: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulseRecord: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    }
  },
  plugins: []
};
