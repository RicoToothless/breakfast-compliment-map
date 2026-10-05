export type Coordinates = { lat: number; lng: number };
export type GPSLocation = Coordinates & { accuracy: number; timestamp: number };
export type Favourite = { id: string; nickname: string };
export type LeaderboardEntry = { id: string; compliments: number };

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
  voteToken?: string;
};

export type RestaurantResponse = {
  restaurants: Restaurant[];
  resultLimitReached: boolean;
};
