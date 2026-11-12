import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      token: null,
      setSession: (session) => set({ user: session.user, token: session.token }),
      setUser: (user) => set({ user }),
      logout: () => set({ user: null, token: null }),
    }),
    {
      name: 'callmanagerai-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);
