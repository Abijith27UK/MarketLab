export interface ConvexClient {
  query: <T>(name: string, args?: any) => Promise<T>;
  mutation: <T>(name: string, args?: any) => Promise<T>;
  get: <T>(table: string, id: string) => Promise<T>;
  list: <T>(table: string, filter?: any) => Promise<T[]>;
  create: <T>(table: string, data: any) => Promise<T>;
  update: <T>(table: string, id: string, data: any) => Promise<T>;
  remove: <T>(table: string, id: string) => Promise<T>;
}

export const convexClient: ConvexClient = {
  query: async <T>(name: string, args?: any): Promise<T> => {
    // Mock implementation - will be replaced with actual Convex client
    return null as any as T;
  },
  mutation: async <T>(name: string, args?: any): Promise<T> => {
    // Mock implementation - will be replaced with actual Convex client
    return null as any as T;
  },
  get: async <T>(table: string, id: string): Promise<T> => {
    // Mock implementation
    return null as any as T;
  },
  list: async <T>(table: string, filter?: any): Promise<T[]> => {
    // Mock implementation
    return [] as T[];
  },
  create: async <T>(table: string, data: any): Promise<T> => {
    // Mock implementation
    return null as any as T;
  },
  update: async <T>(table: string, id: string, data: any): Promise<T> => {
    // Mock implementation
    return null as any as T;
  },
  remove: async <T>(table: string, id: string): Promise<T> => {
    // Mock implementation
    return null as any as T;
  },
};