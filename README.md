# daymi.dev, the benchmark

**this is not my portfolio.** it is a benchmark for how well ai models can design and build a web page: a personal homepage is the brief, because it is small enough to finish and open enough that taste shows. the projects on it are made up, and nothing on it should be read as a real cv. the page is set to `noindex`, and `robots.txt` keeps crawlers out.

static html, css and js. no build step, no dependencies.

## what it tests

a homepage on its own is easy. this one is not, on purpose:

- **layout-aware rendering.** the forest is planted from the page's own layout. it has to read where the text is and keep out of its way, at every width.
- **one idea, carried all the way.** the name, the clearings, the trail, the footer's tree count all come from the same picture. it is easy to add pieces that do not belong.
- **responsiveness that is designed, not just reflowed.** two columns, one column, phones, a phone on its side: each is laid out on its own terms.
- **fallbacks.** no webgl, no javascript, a lost gpu context, reduced motion, a slow machine, print, forced colours. each has to leave a page that still reads well.
- **restraint.** the copy, the type and the colours have to stay out of the forest's way.

## using it

give a model this repo (or the brief without it) and compare what comes back. a fair way to run it:

1. one branch or worktree per model, from the same starting commit.
2. the same prompt, word for word, and the same number of follow-ups.
3. look at it in a browser at a few widths, in light and dark, with javascript off and with reduced motion, and keep screenshots.
4. judge it on how it looks and on the list above, not on how much code there is.

the page as it stands on `main` is the reference.

## the page

the page is the black forest seen from above. the name is cut into the trees, everything else sits in a clearing, and a trail runs through all of it.

### run it

open `index.html`, or serve the folder with anything:

```
npx serve .
```

### change it

- **projects** live in `data/projects.js`. add, remove or reorder entries and reload. each one gets its own clearing and the trail reroutes itself. the six in there are placeholders. it is laid out for a handful: past eight or so short entries the clearings get small and the trail between them starts to look like a diagram.
- **text** is plain html in `index.html`.
- **colours** are custom properties at the top of `css/style.css`, including the forest's, in any notation css understands. there is a second set for dark mode.
- **the name** is the inline svg in `index.html`: a handful of strokes. the forest plants rows of firs along their edges and cuts the clearing to their width (`--stroke` in the stylesheet), so changing the paths changes the lettering.
- **the forest** is `js/forest.js`. it reads the page layout and plants around it: anything with a `data-clearing` attribute gets open ground, and the trail passes through it. `data-clearing="grow"` also opens a little on hover and focus, `"glade"` is left off the trail (the trail goes by it wherever the stylesheet has set it clear of the tail of the y: to the right of it on a wide screen, to the left of it below 85rem, and not at all on phones, where there is no room to), `"sign"` is a small one for a heading, and `"edge"` is where the forest ends.
- **in two columns** the second of every three projects is drawn close round its text, so that the clearings are not all of a size.
- **in one column** (70rem and below) the trail does not go through every project: it goes through some and past others, with forest between. on phones the stylesheet decides which: the second, fourth and fifth of every six have a narrower measure and stand to one side (`.project:nth-child(6n + 2)` and its neighbours in `css/style.css`), and the trail goes by on the other (one of the three has a slightly wider measure, so that its clearing is lower and wider than the other two). the links at the end are set aside in the same way, and the trail leaves the forest past them.

### what it falls back to

the name is drawn in ink by default and only hands over to the forest once a painting of it has been timed and found quick enough. without a forest the gaps between the blocks, which are there to hold it, close up. so:

- no webgl2, no real gpu, forced colours, print, or `forest.js` failing for any reason: no forest. the name stays in ink, the one remark about the view is left out, and the page is otherwise the same.
- the gpu context is lost: back to ink until the forest has been planted and painted again. if it has not come back after a moment the gaps close up too, and whatever was being read stays where it was on the screen.
- no javascript: same, and the project list is replaced by a link to github.
- reduced motion: the forest is there but holds still. it is painted once and only repainted when it has to be.
- a machine that cannot keep up: the canvas drops in resolution first. if that is not enough the forest holds still, as above, and if even a still forest stalls the page it is taken away.

### files

```
index.html
css/style.css
js/site.js        renders the project list
js/forest.js      the forest
data/projects.js
fonts/            barlow, self-hosted (sil open font license)
og.jpg            link preview image
robots.txt        keeps crawlers out
```
