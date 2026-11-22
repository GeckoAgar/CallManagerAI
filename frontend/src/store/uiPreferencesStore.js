import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const useUiPreferencesStore = create(
  persist(
    (set) => ({
      textSize: 'standard',
      setTextSize: (textSize) => set({ textSize: textSize === 'large' ? 'large' : 'standard' }),
    }),
    {
      name: 'callmanagerai-ui-preferences',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ textSize: state.textSize }),
    }
  )
);
