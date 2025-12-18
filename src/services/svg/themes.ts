/**
 * SVG主题配置
 */
import { ThemeOptions } from './types';

/**
 * 默认亮色主题
 */
export const defaultTheme: ThemeOptions = {
  colors: {
    background: '#ffffff',
    border: '#e1e4e8',
    text: {
      primary: '#24292e',
      secondary: '#586069',
      title: '#24292e'
    },
    accent: {
      primary: '#0366d6',
      secondary: '#28a745'
    },
    stats: {
      easy: '#66bb6a',
      medium: '#ffca28',
      hard: '#ef5350',
      total: '#4287f5',
      count: '#9c27b0'
    }
  },
  fonts: {
    family: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
    size: {
      small: '12px',
      normal: '14px',
      title: '18px'
    }
  },
  card: {
    borderRadius: '6px'
  }
};

/**
 * 暗色主题
 */
export const darkTheme: ThemeOptions = {
  colors: {
    background: '#1e1e1e',
    border: '#30363d',
    text: {
      primary: '#c9d1d9',
      secondary: '#8b949e',
      title: '#f0f6fc'
    },
    accent: {
      primary: '#58a6ff',
      secondary: '#3fb950'
    },
    stats: {
      easy: '#57ab5a',
      medium: '#d29922',
      hard: '#f85149',
      total: '#4287f5',
      count: '#b084cc'
    }
  },
  fonts: {
    family: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
    size: {
      small: '12px',
      normal: '14px',
      title: '18px'
    }
  },
  card: {
    borderRadius: '6px'
  }
};

/**
 * 主题映射表
 */
export const themes: Record<string, ThemeOptions> = {
  default: defaultTheme,
  light: defaultTheme,
  dark: darkTheme
};

/**
 * 当前激活的主题
 */
export const activeTheme: ThemeOptions = defaultTheme;
