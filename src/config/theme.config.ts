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

// 导出当前活动主题
export const activeTheme = defaultTheme; 