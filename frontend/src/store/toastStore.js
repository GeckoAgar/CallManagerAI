import { create } from 'zustand';

let nextId = 0;

export const useToastStore = create((set) => ({
  toasts: [],
  notify: (type, message, { announce = true } = {}) => set((state) => ({
    toasts: [...state.toasts, { id: ++nextId, type, message, announce, exiting: false }],
  })),
  dismiss: (id) => set((state) => ({
    toasts: state.toasts.map((toast) => toast.id === id ? { ...toast, exiting: true } : toast),
  })),
  remove: (id) => set((state) => ({
    toasts: state.toasts.filter((toast) => toast.id !== id),
  })),
}));
