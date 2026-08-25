# Olive Oil Lot

`olive-oil-lot` is a fictional composite training case. Its producer, brands,
places, samples, lot numbers, lab method, volumes, and people were invented.
It does not allege misconduct by any real business or person.

The case adapts broad food-fraud investigation mechanics described by Europol:
checking labels and traceability, testing a sealed sample, comparing declared
product with a laboratory profile, and reconciling batch inputs with packaged
output. The simplified lab panel is a game clue, not a regulatory test method
or scientific reference.

This package also exercises the generic value-aware proof grammar: the sealed
sample must explicitly report `seal_intact: true`, the lab reference must be
`false`, the estimated undeclared fraction must exceed `0.5`, and the numeric
batch values must satisfy their declared thresholds. Merely observing those
fields is not enough to support the deductions.

Sources consulted for those mechanics:

- [Europol Operation OPSON](https://www.europol.europa.eu/how-we-work/operations/operation-opson)
- [Europol: olive-oil counterfeiters arrested following Operation OPSON](https://www.europol.europa.eu/media-press/newsroom/news/11-olive-oil-counterfeiters-arrested-following-operation-opson)

Consult the linked official sources for the actual operations and findings.

The three raster evidence images were generated with the built-in ImageGen
workflow for this fictional package. Exact lot codes, measurements, and proof
values remain structured YAML observations rather than pixel-derived facts.
