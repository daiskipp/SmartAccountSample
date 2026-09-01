declare module "qrcode" {
  interface QrCodeOptions {
    margin?: number;
    width?: number;
  }
  function toDataURL(text: string, options?: QrCodeOptions): Promise<string>;
  const QRCode: { toDataURL: typeof toDataURL };
  export default QRCode;
}
