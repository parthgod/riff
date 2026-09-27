export interface RadioStation {
  stationuuid: string;
  name: string;
  url_resolved: string;
  homepage?: string | null;
  favicon?: string | null;
  /** Comma-separated. */
  tags?: string | null;
  country?: string | null;
  countrycode?: string | null;
  codec?: string | null;
  bitrate?: number | null;
  hls: number;
  lastcheckok: number;
}

export interface RadioUrlResponse {
  ok: boolean;
  message?: string;
  stationuuid?: string;
  name?: string;
  url?: string;
}
