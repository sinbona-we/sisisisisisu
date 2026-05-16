/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface OpenMeteoParams {
  latitude: number;
  longitude: number;
  city?: string;
  daily?: string[];
  hourly?: string[];
  start_date?: string;
  end_date?: string;
}

export async function fetchLiveWeatherData(params: OpenMeteoParams) {
  // If we are requesting data before the current date, we should use the archive API
  // Otherwise, use the forecast API
  const today = new Date().toISOString().split('T')[0];
  const isHistorical = params.start_date && params.start_date < today && params.end_date && params.end_date < today;
  
  const baseUrl = isHistorical 
    ? "https://archive-api.open-meteo.com/v1/archive" 
    : "https://api.open-meteo.com/v1/forecast";
    
  const url = new URL(baseUrl);
  url.searchParams.append("latitude", params.latitude.toString());
  url.searchParams.append("longitude", params.longitude.toString());
  // Adding timezone auto makes it return data in local time of the location
  url.searchParams.append("timezone", "auto");
  
  if (params.start_date) {
    url.searchParams.append("start_date", params.start_date);
  }
  if (params.end_date) {
    url.searchParams.append("end_date", params.end_date);
  }
  
  if (params.hourly && params.hourly.length > 0) {
    url.searchParams.append("hourly", params.hourly.join(","));
  }
  if (params.daily && params.daily.length > 0) {
    url.searchParams.append("daily", params.daily.join(","));
  }

  // If using the archive API, we should use the "best_match" model to automatically stitch together ERA5 and recent forecast data
  // to ensure we don't hit the 2-5 day archive delay gap
  if (isHistorical) {
    url.searchParams.append("models", "best_match");
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data;
}

export function formatOpenMeteoData(apiResponse: any, city?: string): any[] {
  let formattedData: any[] = [];
  
  // If both are returned, we prefer daily for simplicity in charts unless hourly is specifically needed.
  // Actually, we can just process whichever has keys other than 'time'.
  const hasDaily = apiResponse.daily && Object.keys(apiResponse.daily).length > 1;
  const hasHourly = apiResponse.hourly && Object.keys(apiResponse.hourly).length > 1;

  if (hasDaily) {
    const timeArray = apiResponse.daily.time;
    formattedData = timeArray.map((timeStr: string, index: number) => {
      const row: any = { date: timeStr, city: city || "Unknown" };
      for (const key of Object.keys(apiResponse.daily)) {
        if (key !== "time") {
          row[key] = apiResponse.daily[key][index];
        }
      }
      return row;
    });
  } else if (hasHourly) {
    const timeArray = apiResponse.hourly.time;
    formattedData = timeArray.map((timeStr: string, index: number) => {
      const row: any = { date: timeStr, city: city || "Unknown" };
      for (const key of Object.keys(apiResponse.hourly)) {
        if (key !== "time") {
          row[key] = apiResponse.hourly[key][index];
        }
      }
      return row;
    });
  }
  
  return formattedData;
}
