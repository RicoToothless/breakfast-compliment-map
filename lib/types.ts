export type Coordinates = { lat: number; lng: number };

export type Restaurant = {
  id: string;
  name: string;
  address: string;
  location: Coordinates;
  googleMapsUri: string;
  attributions: { provider: string; providerUri?: string }[];
  compliments: number;
  complimentedToday: boolean;
  distanceMeters?: number;
};

export type RestaurantResponse = {
  restaurants: Restaurant[];
  resultLimitReached: boolean;
};
