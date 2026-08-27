export type ResponseKind = "places_list" | "place_detail" | "weather" | "events" | "rate" | "rental_list" | "property_list" | "area_recommendation" | "comparison" | "itinerary" | "general" | "freshness_fallback";
export type Language = "ru" | "en" | "th" | "other";

export interface Linkable { map_url?: string; latitude?: number; longitude?: number; website_url?: string; instagram_url?: string }
export interface Place extends Linkable { name: string; area?: string; category?: string; open_status?: "open" | "closed" | "unknown"; closing_time?: string; rating?: number; price_level?: string; reason_to_choose: string }
export interface PlacesList { kind: "places_list"; language: Language; heading: string; items: Place[]; recommendation?: string }
export interface PlaceDetail extends Linkable { kind: "place_detail"; language: Language; name: string; area?: string; category?: string; open_status?: "open" | "closed" | "unknown"; closing_time?: string; rating?: number; price_level?: string; summary: string; verdict?: string }
export interface Weather { kind: "weather"; language: Language; heading: string; temperature: string; condition: string; feels_like?: string; humidity?: string; wind?: string; precipitation?: string; today_summary?: string; forecast?: Array<{ day: string; temperature: string; condition: string }> }
export interface Event extends Linkable { name: string; time?: string; area?: string; price?: string; summary: string }
export interface Events { kind: "events"; language: Language; heading: string; items: Event[] }
export interface RateItem extends Linkable { name: string; pair: string; rate?: string; open_status?: "open" | "closed" | "unknown"; closing_time?: string; area?: string; confirmation?: string }
export interface Rate { kind: "rate"; language: Language; heading: string; items: RateItem[]; note?: string }
export interface RentalItem extends Linkable { name: string; vehicle: string; price?: string; area?: string; reason_to_choose: string }
export interface RentalList { kind: "rental_list"; language: Language; heading: string; items: RentalItem[]; clarification?: string }
export interface PropertyItem extends Linkable { name: string; bedrooms?: string; size?: string; price?: string; area?: string; reason_to_choose: string }
export interface PropertyList { kind: "property_list"; language: Language; heading: string; items: PropertyItem[] }
export interface AreaRecommendation { kind: "area_recommendation"; language: Language; heading: string; areas: Array<{ name: string; pros: string[]; cons: string[] }>; recommendation?: string }
export interface Comparison { kind: "comparison"; language: Language; heading: string; options: Array<{ name: string; points: string[] }>; recommendation?: string }
export interface ItineraryStop extends Linkable { time?: string; name: string; description: string }
export interface Itinerary { kind: "itinerary"; language: Language; heading: string; stops: ItineraryStop[] }
export interface General { kind: "general"; language: Language; heading?: string; paragraphs: string[] }
export interface FreshnessFallback { kind: "freshness_fallback"; language: Language; heading: string; explanation: string; next_step?: string }
export type StructuredResponse = PlacesList | PlaceDetail | Weather | Events | Rate | RentalList | PropertyList | AreaRecommendation | Comparison | Itinerary | General | FreshnessFallback;

export interface TelegramAction { text: string; url: string }
export type TelegramActionRow = TelegramAction[];
export interface RenderedResponse { text: string; sections: string[]; actions: TelegramActionRow[]; kind: ResponseKind; itemCount: number }
export type RenderedTelegramResponse = RenderedResponse;
