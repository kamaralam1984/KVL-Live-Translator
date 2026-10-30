export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  level: ToastLevel;
  message: string;
  action?: ToastAction;
}

export function Toast({ level, message, action, onAction }: { level: ToastLevel; message: string; action?: ToastAction; onAction?: () => void }) {
  return (
    <div className={`kvl-toast kvl-toast-${level}`}>
      <span className="kvl-toast-dot" />
      <div className="flex flex-1 flex-col gap-1.5">
        <span>{message}</span>
        {action && (
          <button
            type="button"
            className="self-start text-[11.5px] font-semibold text-accent underline underline-offset-2 hover:opacity-80"
            onClick={() => {
              action.onClick();
              onAction?.();
            }}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
