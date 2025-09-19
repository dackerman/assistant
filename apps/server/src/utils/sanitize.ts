const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -\/]*[@-~]/gu
const OSC_PATTERN = /\u001b\][^\u0007]*(\u0007|\u001b\\)/gu
const CONTROL_PATTERN = /[\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/gu

export function sanitizeShellOutput(value: string): string {
  if (!value) return value

  return value
    .replace(/\r\n?/gu, '\n')
    .replace(ANSI_PATTERN, '')
    .replace(OSC_PATTERN, '')
    .replace(CONTROL_PATTERN, '')
}
