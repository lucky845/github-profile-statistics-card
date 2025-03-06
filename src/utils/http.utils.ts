import axios from 'axios';

// 创建带有超时时间的HTTP请求
export const createRequest = (timeout = 10000) => {
  return axios.create({
    timeout,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    }
  });
}; 