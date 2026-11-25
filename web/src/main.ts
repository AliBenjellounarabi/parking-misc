import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { ParkingApp } from './parking-app';

bootstrapApplication(ParkingApp, {
  providers: [provideZonelessChangeDetection()],
}).catch(error => console.error(error));
