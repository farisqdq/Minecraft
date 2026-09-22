"use client";

import Modal from "./Modal";
import styles from "./overlay.module.css";
import dash from "../dashboard/dashboard.module.css";

export type ConfirmRequest = {
  title: string;
  body: string;
  confirmLabel: string;
  /** Overrides the cancel wording; defaults to what fits the tone below. */
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
};

/**
 * Replaces window.confirm, which on a phone is a system alert that gives no
 * room to explain what is about to be deleted.
 */
export default function ConfirmDialog({
  request,
  onCancel,
}: {
  request: ConfirmRequest | null;
  onCancel: () => void;
}) {
  if (!request) return null;

  return (
    <Modal open title={request.title} subtitle={request.body} onClose={onCancel} narrow topLayer>
      <div className={styles.confirmActions}>
        <button type="button" className={dash.btn} onClick={onCancel}>
          {/* "Keep it" only makes sense opposite a delete. */}
          {request.cancelLabel ?? (request.danger ? "Keep it" : "Cancel")}
        </button>
        <button
          type="button"
          className={`${dash.btn} ${request.danger ? dash.danger : dash.primary}`}
          onClick={() => {
            request.onConfirm();
            onCancel();
          }}
        >
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
