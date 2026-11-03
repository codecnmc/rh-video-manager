export class ImageHttpError extends Error {
  constructor(readonly status: number) { super('生图服务请求失败') }
}

// 仅传递预定义安全描述，不携带密钥、签名 URL 或底层异常正文。
export class ImageRequestError extends Error {}
