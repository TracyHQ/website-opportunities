// Which trade a business is in, from its Google Places types: what picks a template and the words a brief uses
// for any business, where `place-kinds.mjs` (the six Find tabs) knows only food and drink. A type this table does
// not name is `other`, never a guess.
import { kindOfPrimaryType } from './place-kinds.mjs';

export const TRADES = Object.freeze([
  'food', 'beauty', 'health', 'fitness', 'hospitality', 'travel', 'professional', 'creative', 'education',
  'retail', 'auto', 'home', 'events', 'nonprofit', 'other',
]);

// Exact Google Places (New) types (Table A) for each trade; `food` is every type `place-kinds.mjs` folds.
const BY_TRADE = {
  beauty: [
    'beauty_salon', 'hair_salon', 'hair_care', 'nail_salon', 'barber_shop', 'spa', 'massage', 'tanning_studio',
    'skin_care_clinic', 'makeup_artist', 'beautician', 'body_art_service', 'sauna', 'wellness_center',
  ],
  health: [
    'dentist', 'dental_clinic', 'doctor', 'hospital', 'medical_clinic', 'medical_lab', 'pharmacy', 'drugstore',
    'physiotherapist', 'chiropractor', 'veterinary_care', 'general_hospital', 'optician',
  ],
  fitness: ['gym', 'fitness_center', 'yoga_studio', 'sports_club', 'sports_coaching', 'swimming_pool', 'pilates_studio'],
  hospitality: [
    'lodging', 'hotel', 'motel', 'resort_hotel', 'inn', 'bed_and_breakfast', 'guest_house', 'hostel',
    'extended_stay_hotel', 'farmstay', 'campground', 'cottage', 'private_guest_room',
  ],
  travel: ['travel_agency', 'tour_agency', 'tourist_information_center', 'car_rental'],
  professional: [
    'lawyer', 'accounting', 'insurance_agency', 'real_estate_agency', 'consultant', 'finance', 'bank',
    'corporate_office', 'employment_agency', 'marketing_agency', 'courier_service', 'telecommunications_service_provider',
  ],
  creative: ['art_studio', 'photography_studio', 'graphic_designer', 'design_studio', 'tattoo_parlor', 'florist'],
  education: [
    'school', 'primary_school', 'secondary_school', 'university', 'preschool', 'library', 'driving_school',
    'language_school', 'music_school', 'tutoring_service', 'child_care_agency',
  ],
  retail: [
    'store', 'clothing_store', 'shoe_store', 'jewelry_store', 'book_store', 'gift_shop', 'furniture_store',
    'electronics_store', 'home_goods_store', 'hardware_store', 'grocery_store', 'supermarket', 'convenience_store',
    'liquor_store', 'pet_store', 'sporting_goods_store', 'shopping_mall', 'department_store', 'market',
    'cell_phone_store', 'bicycle_store', 'garden_center', 'home_improvement_store', 'discount_store', 'wholesaler',
  ],
  auto: ['car_repair', 'car_dealer', 'car_wash', 'gas_station', 'electric_vehicle_charging_station', 'auto_parts_store', 'tire_shop'],
  home: [
    'plumber', 'electrician', 'roofing_contractor', 'painter', 'locksmith', 'moving_company', 'general_contractor',
    'laundry', 'cleaning_service', 'hvac_contractor', 'landscaper', 'storage',
  ],
  events: [
    'event_venue', 'wedding_venue', 'banquet_hall', 'convention_center', 'night_club', 'concert_hall',
    'performing_arts_theater', 'movie_theater', 'museum', 'art_gallery', 'amusement_park', 'bowling_alley',
  ],
  nonprofit: ['church', 'mosque', 'synagogue', 'hindu_temple', 'place_of_worship', 'non_profit_organization', 'community_center'],
};
const TRADE_OF = new Map(Object.entries(BY_TRADE).flatMap(([trade, types]) => types.map((t) => [t, trade])));

/**
 * The trade of one place: its primary type first, then its other types in order; a food or drink type is `food`.
 * @param {{ primaryType?: string | null, types?: string[] | null, kind?: string | null }} place
 * @returns {(typeof TRADES)[number]}
 */
export function tradeOfPlace({ primaryType = null, types = null, kind = null } = {}) {
  if (kind) return 'food';
  for (const type of [primaryType, ...(Array.isArray(types) ? types : [])]) {
    if (typeof type !== 'string' || !type) continue;
    if (kindOfPrimaryType(type)) return 'food';
    const trade = TRADE_OF.get(type);
    if (trade) return trade;
  }
  return 'other';
}

// schema.org LocalBusiness subtypes (`website-crawler.mjs` BUSINESS_TYPES) for each trade.
const BY_SCHEMA = {
  food: ['Restaurant', 'FoodEstablishment', 'CafeOrCoffeeShop', 'BarOrPub', 'FastFoodRestaurant', 'Bakery', 'Brewery', 'Winery', 'IceCreamShop', 'Distillery'],
  health: ['Dentist', 'MedicalBusiness', 'MedicalClinic', 'MedicalOrganization', 'Physician', 'Pharmacy', 'Optician', 'VeterinaryCare'],
  beauty: ['HealthAndBeautyBusiness', 'BeautySalon', 'DaySpa', 'HairSalon', 'NailSalon'],
  fitness: ['HealthClub', 'ExerciseGym', 'SportsActivityLocation'],
  hospitality: ['LodgingBusiness', 'Hotel', 'Motel', 'Resort', 'BedAndBreakfast', 'Hostel'],
  travel: ['TravelAgency', 'AutoRental'],
  professional: ['ProfessionalService', 'LegalService', 'Attorney', 'Notary', 'AccountingService', 'FinancialService', 'InsuranceAgency', 'RealEstateAgent', 'EmploymentAgency'],
  creative: ['TattooParlor', 'Florist', 'ArtGallery'],
  retail: ['Store', 'ClothingStore', 'JewelryStore', 'BookStore', 'FurnitureStore', 'HomeGoodsStore'],
  auto: ['AutomotiveBusiness', 'AutoRepair', 'AutoDealer'],
  home: ['HomeAndConstructionBusiness', 'Plumber', 'Electrician', 'GeneralContractor', 'RoofingContractor', 'HousePainter', 'Locksmith', 'MovingCompany', 'DryCleaningOrLaundry'],
  education: ['EducationalOrganization', 'School', 'ChildCare'],
  events: ['EntertainmentBusiness', 'EventVenue', 'NightClub', 'Museum'],
  nonprofit: ['NGO', 'PlaceOfWorship'],
};
const SCHEMA_TRADE = new Map(Object.entries(BY_SCHEMA).flatMap(([trade, types]) => types.map((t) => [t, trade])));

/**
 * The trade a business's own website states (its schema.org `@type`), or `other` for `LocalBusiness` and anything
 * this table does not name.
 * @param {string | null | undefined} type
 */
export function tradeOfSchemaType(type) {
  return SCHEMA_TRADE.get(type) ?? 'other';
}
