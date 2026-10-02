export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const unauthorized = (message = '请先登录') => new HttpError(401, message);
export const forbidden = (message = '没有权限') => new HttpError(403, message);
export const notFound = (message = '资源不存在') => new HttpError(404, message);
export const conflict = (message) => new HttpError(409, message);
export const tooLarge = (message = '内容过大') => new HttpError(413, message);
export const tooMany = (message = '操作太频繁，请稍后再试') => new HttpError(429, message);
export const unsupportedMedia = (message = '不支持的请求类型') => new HttpError(415, message);
