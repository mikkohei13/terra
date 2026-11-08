# Terra

Terra is a mobile-first web app to make nature observations and submit them to FinBIF API.

Built with Python/Flask with vanilla JavaScript and CSS.

## Planned App Features

### Deployment

App is run on Google Cloud Run. Makefile contains the deployment script.

### Authentication

User logins via the sister app Havistin2 at http//havistin.biomi.org. Havistin2 has a link to Terra, which delivers the person token to /login endpoint of this app e.g. as GET or POST parameter.

Terra has a logout link which clears the person token.

Repository of havistin2 is at ../havistin2

### Making Observations

Terra is used to record nature observations e.g. of birds and plants outdoors, in a way that is quikc and easy, even at bad weather, requiring minimal interaction.

The basic process of recording observations is

- User starts an observation session. The app notes begin datetime and location wgs84 decimal degree coordinates from the phone GPS.
- The app loads observations from FinBIF API at api.laji.fi from this region (bounding box of 50 km), this season (date +-14 days) from the last 20 years. It generates a table of top 100 species names and how many times each was observed. This is later used to suggest common taxa.
- User walks around. The app has a map and shows location of the user.
- The app does not track user location continuously. Only when the app is activated, it records user location and adds them to a list of point coordinates. This list will be called "the route" from now on. This aboids need to fight with phone battery saving features which easily break continuous tracking.
- User taps a button to make an observation. The app shows an observation entry view.
- The app records current coordinates and adds them to the route, unless they are less than 100 meters from other coordinates on the route.
- The app shows a list of top 10 species, so that user can easily select one of them without writing.
- The app also has a taxon field where user can type. When user starts typing a name, the app shows two dropdowns:
    1) Dropdown based on the list of top 100 species, ordered by times observed descending.
    2) Dropdown based on a call to FinBIF /autocomplete/taxa endpoint, doing fuzzy matching to taxon names
- User selects a taxon. The app shows a way to clear the taxon.
- User fills in a count field, which accepts free text, so they can e.g. write "5", "a lot", ">10 flowering", "3 migrating" or "2 males, 3 females".
- App shows a button to increase the count by one, but only if it is clear which number should be increased. E.g. "3 migrating" can be increased to "4 migrating", but with "2 males, 3 females" it is ambigious, so the button is disables.
- There are additional fields:
    - Notes; free text
    - Wildness; radio button with unknown, wild, non-wild
- User can save the observation, returning to the map view.
- User can easily select an observation from a map to be edited. Editing leads to the observation entry view.
- There is also a list view, which shows observations in the order in which they were added.

Clarify these specs with Claude.

Firs, generate an arcthitecture plan for an app that has these features. Keep it simple yet extensible.

