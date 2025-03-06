/**
 * Polyfill 文件 - 提供对 Web Streams API 的兼容支持
 */
import { Readable } from 'stream';

// 如果全局对象中不存在 ReadableStream，则提供一个基于 Node.js Streams 的实现
if (typeof globalThis.ReadableStream === 'undefined') {
  // @ts-ignore
  globalThis.ReadableStream = Readable;
}

// 导出一个空对象，确保这个文件可以被导入
export {}; 