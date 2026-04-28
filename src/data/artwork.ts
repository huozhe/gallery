export type Artwork = {
  id: string;
  title: string;
  year: number;
  medium: string;
  dimensions?: string;
  description?: string;
  image: string;
};

export const artworks: Artwork[] = [
  {
    id: "Eskimo-Madonna",
    title: "Eskimo Madonna",
    year: 2026,
    medium: "Charcoal",
    image: "/artwork/PXL_20260120_053258541.jpg",
    description: "Eskimo Madonna Nome, Alaska. The original photograph https://vilda.alaska.edu/digital/collection/cdmg21/id/24086/",
  },
  {
    id: "Blossom",
    title: "Blossom",
    year: 2026,
    medium: "Charcoal",
    image: "/artwork/PXL_20260202_063046595.jpg",
    description: "Reproduction of the detailed etching titled \"Blossom\" by the renowned artist Harley Brown. Created in 1982, it was a portrait of a young Chipewyan girl. The original drawing https://bid.marchinmontana.com/online-auctions/march-in-montana-auction/harley-brown-two-etchings-with-limited-edition-book-4774726"
  },
  {
    id: "Yosemite-Valley",
    title: "Yosemite Valley",
    year: 2026,
    medium: "Tombow pen, Pentel Aquash water brush",
    image: "/artwork/PXL_20260318_004653935.jpg",
  },
  {
    id: "Rialto-Bridge-Over-The-Grand-Canal-Venice",
    title: "Rialto Bridge Over The Grand Canal Venice",
    year: 2026,
    medium: "Watercolor",
    image: "/artwork/PXL_20260325_030417002~2.jpg",
  },
  {
    id: "Highland-Light-Cape-Cod-Massachusetts",
    title: "Highland Light, Cape Cod, Massachusetts",
    year: 2026,
    medium: "Charcoal",
    image: "/artwork/PXL_20260401_012728221.jpg",
  },
];

export function getArtwork(id: string): Artwork | undefined {
  return artworks.find((a) => a.id === id);
}
