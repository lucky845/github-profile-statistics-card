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
      title: string;      // 标题字体大小
    };
  };

  // 卡片配置
  card: {
    borderRadius: string; // 卡片圆角
  };
}

// 默认亮色主题
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

// 暗色主题
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

// 蓝色主题
export const merkoTheme: ThemeOptions = {
  colors: {
    background: '#e3f2fd',
    border: '#90caf9',
    text: {
      primary: '#0d47a1',
      secondary: '#1565c0',
      title: '#0d47a1'
    },
    accent: {
      primary: '#2196f3',
      secondary: '#42a5f5'
    },
    stats: {
      easy: '#42a5f5',
      medium: '#4fc3f7',
      hard: '#29b6f6',
      total: '#2196f3',
      count: '#1e88e5'
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

// 绿色主题
export const gruvboxTheme: ThemeOptions = {
  colors: {
    background: '#e8f5e9',
    border: '#a5d6a7',
    text: {
      primary: '#1b5e20',
      secondary: '#2e7d32',
      title: '#1b5e20'
    },
    accent: {
      primary: '#4caf50',
      secondary: '#66bb6a'
    },
    stats: {
      easy: '#66bb6a',
      medium: '#81c784',
      hard: '#4db6ac',
      total: '#4caf50',
      count: '#43a047'
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

// 紫色主题
export const gruvboxLightTheme: ThemeOptions = {
  colors: {
    background: '#f3e5f5',
    border: '#ce93d8',
    text: {
      primary: '#4a148c',
      secondary: '#6a1b9a',
      title: '#4a148c'
    },
    accent: {
      primary: '#9c27b0',
      secondary: '#ab47bc'
    },
    stats: {
      easy: '#ab47bc',
      medium: '#ba68c8',
      hard: '#8e24aa',
      total: '#9c27b0',
      count: '#8e24aa'
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

// GitHub Dark Dimmed（GitHub 官方暗色主题的一套配色）
export const githubDimmedTheme: ThemeOptions = {
  colors: {
    background: '#22272e',
    border: '#444c56',
    text: {
      primary: '#adbac7',
      secondary: '#768390',
      title: '#cdd9e5'
    },
    accent: {
      primary: '#539bf5',
      secondary: '#6cb6ff'
    },
    stats: {
      easy: '#57ab5a',
      medium: '#c69026',
      hard: '#e5534b',
      total: '#539bf5',
      count: '#adbac7'
    }
  },
  fonts: {
    family: '-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans SC, sans-serif',
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

// 透明背景：只画文字与描边，嵌进任意配色的博客都合适
export const transparentTheme: ThemeOptions = {
  colors: {
    background: 'transparent',
    border: '#d0d7de',
    text: {
      primary: '#1f2328',
      secondary: '#59636e',
      title: '#1f2328'
    },
    accent: {
      primary: '#0969da',
      secondary: '#1a7f37'
    },
    stats: {
      easy: '#1a7f37',
      medium: '#9a6700',
      hard: '#cf222e',
      total: '#0969da',
      count: '#1f2328'
    }
  },
  fonts: {
    family: '-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans SC, sans-serif',
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

// 红色主题
export const onedarkTheme: ThemeOptions = {
  colors: {
    background: '#ffebee',
    border: '#ef9a9a',
    text: {
      primary: '#b71c1c',
      secondary: '#c62828',
      title: '#b71c1c'
    },
    accent: {
      primary: '#f44336',
      secondary: '#ef5350'
    },
    stats: {
      easy: '#ef5350',
      medium: '#ec407a',
      hard: '#ab47bc',
      total: '#f44336',
      count: '#d32f2f'
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

// 导出所有主题
//
// 之前这里有 8 个名字，但 blue/green/purple/orange/red 只是把 merko/gruvbox/
// tokyonight/onedark 换了个壳——用户以为有 8 种，实际只有 4 种配色。
// 现在只暴露真实存在的 4 个，名字与视觉一致。
export const themes: Record<string, ThemeOptions> = {
  light: defaultTheme,
  dark: darkTheme,
  'github-dark-dimmed': githubDimmedTheme,
  transparent: transparentTheme
};

// 导出当前活动主题
export const activeTheme = defaultTheme; 