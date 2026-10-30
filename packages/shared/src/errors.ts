export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}

export class ProviderError extends AppError {
  constructor(message: string) {
    super('PROVIDER_ERROR', message);
    this.name = 'ProviderError';
  }
}
