export {}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: {
            client_id: string
            callback(response: { credential?: string }): void
          }): void
          renderButton(
            parent: HTMLElement,
            options: {
              theme?: string
              size?: string
              type?: string
              shape?: string
              text?: string
              width?: number
            },
          ): void
        }
      }
    }
  }
}
