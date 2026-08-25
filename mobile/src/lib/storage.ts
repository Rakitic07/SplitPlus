import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "splitplus_token";

export const storage = {
  async getToken(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  async setToken(token: string | null): Promise<void> {
    try {
      if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
      else await AsyncStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
  async getItem(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  // Typed JSON cache helpers — used for stale-while-revalidate so screens can
  // paint last-known data instantly instead of a long shimmer on cold starts.
  async getJSON<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  async setJSON(key: string, value: unknown): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore — cache is best-effort */
    }
  },
};
