import Image from "next/image";
import type { ReactNode } from "react";

import type {
  RuntimeProfileSection,
  RuntimeWebsiteExperience,
  RuntimeWebsiteImage,
} from "../../runtime-types";
import { ExternalAction } from "./ExternalAction";

export function ProfileSection({
  section,
  assets,
  experience,
}: {
  readonly section: RuntimeProfileSection;
  readonly assets: readonly RuntimeWebsiteImage[];
  readonly experience?: RuntimeWebsiteExperience | undefined;
}): ReactNode {
  switch (section.type) {
    case "SERVICES":
    case "PROCESS":
    case "EVENTS":
    case "COLLECTIONS":
      return (
        <ul className="profile-card-grid">
          {section.items.map((item) => (
            <li key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </li>
          ))}
        </ul>
      );
    case "TRUST_SIGNALS":
      return (
        <>
          <ul className="profile-trust-list">
            {section.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
          {section.disclaimer === undefined
            ? null
            : <p className="profile-disclaimer">{section.disclaimer}</p>}
        </>
      );
    case "GALLERY":
      return (
        <div className="profile-gallery">
          {section.items.map((item, index) => {
            const image = assets.find(({ asset }) => asset.assetId === item.assetId);
            return (
              <figure key={item.assetId} data-asset-id={item.assetId}>
                {image === undefined
                  ? <div className="profile-image-unavailable">{item.alt}</div>
                  : <Image
                      alt={item.alt}
                      height={image.asset.height}
                      sizes={galleryImageSizes(
                        experience?.designDna.media.galleryFrame,
                        index,
                      )}
                      src={image.asset.publicPath}
                      width={image.asset.width}
                    />}
                {item.caption === undefined ? null : <figcaption>{item.caption}</figcaption>}
              </figure>
            );
          })}
        </div>
      );
    case "TESTIMONIALS":
      return (
        <ul className="profile-quote-list">
          {section.items.map((item) => (
            <li key={`${item.attribution}-${item.quote}`}>
              <blockquote><p>{item.quote}</p></blockquote>
              <p className="profile-attribution">{item.attribution}</p>
              {item.disclosure === undefined ? null : <p className="profile-disclaimer">{item.disclosure}</p>}
            </li>
          ))}
        </ul>
      );
    case "FAQ":
      return (
        <div className="profile-faq-list">
          {section.items.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      );
    case "MENU":
      return (
        <div className="profile-menu">
          {section.categories.map((category) => (
            <section aria-label={category.name} key={category.name}>
              <h3>{category.name}</h3>
              {category.description === undefined ? null : <p>{category.description}</p>}
              <ul>
                {category.items.map((item) => (
                  <li key={item.name}>
                    <span><strong>{item.name}</strong>{item.description === undefined ? null : <small>{item.description}</small>}</span>
                    <span>{item.price}</span>
                    {item.dietary.length === 0 ? null : <small>{item.dietary.join(" · ")}</small>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      );
    case "HOURS":
      return (
        <>
          <dl className="profile-hours">
            {section.periods.map((period) => (
              <div key={`${period.days}-${period.hours}`}><dt>{period.days}</dt><dd>{period.hours}</dd></div>
            ))}
          </dl>
          {section.exceptions.length === 0 ? null : <ul className="profile-exceptions">{section.exceptions.map((exception) => <li key={exception}>{exception}</li>)}</ul>}
        </>
      );
    case "LOCATION": {
      const location = section.location;
      return (
        <address className="profile-location">
          <strong>{location.name}</strong>
          {location.addressLines.map((line) => <span key={line}>{line}</span>)}
          <span>{location.locality}, {location.region} {location.postalCode}</span>
          {location.directionsUrl === undefined ? null : <a href={location.directionsUrl}>Get directions</a>}
        </address>
      );
    }
    case "STORY":
    case "CONTACT":
      return <p className="profile-prose">{section.body}</p>;
    case "PRODUCTS":
      return (
        <ul className="profile-product-grid">
          {section.items.map((item) => {
            const image = item.assetId === undefined
              ? undefined
              : assets.find(({ asset }) => asset.assetId === item.assetId);
            return (
              <li data-asset-id={item.assetId} key={item.name}>
                {item.assetId === undefined
                  ? null
                  : image === undefined
                    ? <div className="profile-image-unavailable">{item.name}</div>
                    : <Image
                        alt={image.alt}
                        height={image.asset.height}
                        sizes="(min-width: 64rem) 33vw, (min-width: 40rem) 50vw, 100vw"
                        src={image.asset.publicPath}
                        width={image.asset.width}
                      />}
                <h3>{item.name}</h3>
                <p>{item.description}</p>
                {item.price === undefined ? null : <p className="profile-price">{item.price}</p>}
              </li>
            );
          })}
        </ul>
      );
    case "POLICIES":
      return (
        <dl className="profile-policy-list">
          {section.items.map((item) => <div key={item.title}><dt>{item.title}</dt><dd>{item.body}</dd></div>)}
        </dl>
      );
    case "ACTIONS":
      return <div className="profile-actions">{section.actions.map((action) => <ExternalAction action={action} key={action.actionId} />)}</div>;
  }
}

function galleryImageSizes(
  frame:
    | RuntimeWebsiteExperience["designDna"]["media"]["galleryFrame"]
    | undefined,
  index: number,
): string {
  if (frame !== "EDITORIAL") {
    return "(min-width: 64rem) 33vw, (min-width: 40rem) 50vw, 100vw";
  }
  return index === 0
    ? "(min-width: 64rem) 62vw, (min-width: 40rem) 58vw, 100vw"
    : "(min-width: 64rem) 30vw, (min-width: 40rem) 38vw, 100vw";
}
