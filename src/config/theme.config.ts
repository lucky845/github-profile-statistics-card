// 主题配置选项
export interface ThemeOptions {
  // 基本配色
  colors: {
    background: string;    // 背景色
    border: string;        // 边框色
    text: {
      primary: string;     // 主文本色
      secondary: string;   // 次要文本色
      title: string;       // 标题文本色
    };
    accent: {
      primary: string;     // 主强调色
      secondary: string;   // 次要强调色
    };
    stats: {
      total: string;       // 总计数值颜色
      easy: string;        // 简单级别颜色 (LeetCode)
      medium: string;      // 中等级别颜色 (LeetCode)
      hard: string;        // 困难级别颜色 (LeetCode)
      count: string;       // 计数颜色 (GitHub)
    };
  };
  
  // 字体配置
  fonts: {
    family: string;       // 字体族
    size: {
      small: string;      // 小字体大小
      normal: string;     // 标准字体大小
      large: string;      // 大字体大小 
      title: string;      // 标题字体大小
    };
  };

  // 卡片配置
  card: {
    borderRadius: string; // 卡片圆角
    shadow: string;       // 卡片阴影
    padding: string;      // 卡片内边距
  };
}

// 默认主题
export const defaultTheme: ThemeOptions = {
  colors: {
    background: '#ffffff',
    border: '#e9ecef',
    text: {
      primary: '#343a40',
      secondary: '#6c757d',
      title: '#2c3e50',
    },
    accent: {
      primary: '#3498db',
      secondary: '#2ecc71',
    },
    stats: {
      total: '#3c4b64',
      easy: '#00b8a3',
      medium: '#ffc01e',
      hard: '#ff375f',
      count: '#6f42c1',
    },
  },
  fonts: {
    family: 'Arial, sans-serif',
    size: {
      small: '12px',
      normal: '14px',
      large: '18px',
      title: '20px',
    },
  },
  card: {
    borderRadius: '10px',
    shadow: '0 2px 5px rgba(0,0,0,0.1)',
    padding: '20px',
  },
};

// 暗黑主题
export const darkTheme: ThemeOptions = {
  colors: {
    background: '#1e1e2e',
    border: '#313244',
    text: {
      primary: '#cdd6f4',
      secondary: '#a6adc8',
      title: '#f5e0dc',
    },
    accent: {
      primary: '#89b4fa',
      secondary: '#a6e3a1',
    },
    stats: {
      total: '#cba6f7',
      easy: '#94e2d5',
      medium: '#f9e2af',
      hard: '#f38ba8',
      count: '#b4befe',
    },
  },
  fonts: {
    family: 'Arial, sans-serif',
    size: {
      small: '12px',
      normal: '14px',
      large: '18px',
      title: '20px',
    },
  },
  card: {
    borderRadius: '10px',
    shadow: '0 2px 5px rgba(0,0,0,0.2)',
    padding: '20px',
  },
};

// Merko 主题
export const merkoTheme: ThemeOptions = {
  colors: {
    background: '#2d2d2d',
    border: '#4d4d4d',
    text: {
      primary: '#ffffff',
      secondary: '#b3b3b3',
      title: '#ffffff',
    },
    accent: {
      primary: '#ffcc00',
      secondary: '#ffcc00',
    },
    stats: {
      total: '#ffffff',
      easy: '#00ff00',
      medium: '#ffff00',
      hard: '#ff0000',
      count: '#ffcc00',
    },
  },
  fonts: {
    family: 'Arial, sans-serif',
    size: {
      small: '12px',
      normal: '14px',
      large: '18px',
      title: '20px',
    },
  },
  card: {
    borderRadius: '10px',
    shadow: '0 2px 5px rgba(0,0,0,0.2)',
    padding: '20px',
  },
};

// Gruvbox 主题
export const gruvboxTheme: ThemeOptions = {
  colors: {
    background: '#fbf1c7',
    border: '#d5c4a1',
    text: {
      primary: '#3c3836',
      secondary: '#7c6f64',
      title: '#3c3836',
    },
    accent: {
      primary: '#fb4934',
      secondary: '#b8bb26',
    },
    stats: {
      total: '#3c3836',
      easy: '#b8bb26',
      medium: '#fabd2f',
      hard: '#fb4934',
      count: '#3c3836',
    },
  },
  fonts: {
    family: 'Arial, sans-serif',
    size: {
      small: '12px',
      normal: '14px',
      large: '18px',
      title: '20px',
    },
  },
  card: {
    borderRadius: '10px',
    shadow: '0 2px 5px rgba(0,0,0,0.2)',
    padding: '20px',
  },
};

// Gruvbox Light 主题
export const gruvboxLightTheme: ThemeOptions = {
  colors: {
    background: '#fbf1c7',
    border: '#d5c4a1',
    text: {
      primary: '#3c3836',
      secondary: '#7c6f64',
      title: '#3c3836',
    },
    accent: {
      primary: '#fb4934',
      secondary: '#b8bb26',
    },
    stats: {
      total: '#3c3836',
      easy: '#b8bb26',
      medium: '#fabd2f',
      hard: '#fb4934',
      count: '#3c3836',
    },
  },
  fonts: {
    family: 'Arial, sans-serif',
    size: {
      small: '12px',
      normal: '14px',
      large: '18px',
      title: '20px',
    },
  },
  card: {
    borderRadius: '10px',
    shadow: '0 2px 5px rgba(0,0,0,0.2)',
    padding: '20px',
  },
};

// Tokyo Night 主题
export const tokyonightTheme: ThemeOptions = {
  colors: {
    background: '#1f1f28',
    border: '#3b3b58',
    text: {
      primary: '#c0caf5',
      secondary: '#a9b1d6',
      title: '#c0caf5',
    },
    accent: {
      primary: '#7aa2f7',
      secondary: '#a9b1d6',
    },
    stats: {
      total: '#c0caf5',
      easy: '#9ece6a',
      medium: '#e0af68',
      hard: '#ff757f',
      count: '#c0caf5',
    },
  },
  fonts: {
    family: 'Arial, sans-serif',
    size: {
      small: '12px',
      normal: '14px',
      large: '18px',
      title: '20px',
    },
  },
  card: {
    borderRadius: '10px',
    shadow: '0 2px 5px rgba(0,0,0,0.2)',
    padding: '20px',
  },
};

// One Dark 主题
export const onedarkTheme: ThemeOptions = {
  colors: {
    background: '#282c34',
    border: '#3e4451',
    text: {
      primary: '#abb2bf',
      secondary: '#5c6370',
      title: '#61afef',
    },
    accent: {
      primary: '#e06c75',
      secondary: '#98c379',
    },
    stats: {
      total: '#e06c75',
      easy: '#98c379',
      medium: '#e5c07b',
      hard: '#c678dd',
      count: '#61afef',
    },
  },
  fonts: {
    family: 'Arial, sans-serif',
    size: {
      small: '12px',
      normal: '14px',
      large: '18px',
      title: '20px',
    },
  },
  card: {
    borderRadius: '10px',
    shadow: '0 2px 5px rgba(0,0,0,0.2)',
    padding: '20px',
  },
};

// 导出所有主题
export const themes = {
  default: defaultTheme,
  dark: darkTheme,
  merko: merkoTheme,
  gruvbox: gruvboxTheme,
  gruvbox_light: gruvboxLightTheme,
  tokyonight: tokyonightTheme,
  onedark: onedarkTheme,
};

// 导出当前活动主题
export const activeTheme = defaultTheme; 